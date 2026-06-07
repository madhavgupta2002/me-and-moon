// MapPanel.js — keyless map using Leaflet + OpenStreetMap tiles inside a WebView.
//
// This avoids any Google Maps API key. OpenStreetMap raster tiles are free to
// use (subject to the OSM tile usage policy). The map shows the user, the
// sub-lunar point, and the "circle" (spherical cap) between them.

import { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet } from 'react-native';

const WebView = Platform.OS === 'web' ? null : require('react-native-webview').WebView;

function buildHtml() {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; background: #0b1026; }
    .pin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 6px rgba(0,0,0,0.5); }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var RN = window.ReactNativeWebView;
    var map = L.map('map', { zoomControl: true, attributionControl: true }).setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    function pin(color) {
      return L.divIcon({ className: '', html: '<div class="pin" style="background:' + color + '"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
    }

    // Created draggable so the drag handler exists; toggled per update.
    var userMarker = L.marker([0, 0], { icon: pin('#4f8cff'), draggable: true }).addTo(map).bindTooltip('You');
    var moonMarker = L.marker([0, 0], { icon: pin('#ffd24f'), draggable: true }).addTo(map).bindTooltip('Moon overhead');
    var cap = L.circle([0, 0], { radius: 0, color: '#ffd24f', weight: 2, fillColor: '#ffd24f', fillOpacity: 0.12 }).addTo(map);

    function post(kind, latlng) {
      var msg = JSON.stringify({ type: 'drag', kind: kind, lat: latlng.lat, lon: latlng.lng });
      if (RN) RN.postMessage(msg);
      else if (window.parent !== window) window.parent.postMessage(msg, '*');
    }
    moonMarker.on('drag', function () { cap.setLatLng(moonMarker.getLatLng()); });
    userMarker.on('dragend', function () { post('user', userMarker.getLatLng()); });
    moonMarker.on('dragend', function () { post('moon', moonMarker.getLatLng()); });

    var firstFit = true;
    window.updateMoon = function (d) {
      userMarker.setLatLng([d.userLat, d.userLon]);
      moonMarker.setLatLng([d.moonLat, d.moonLon]);
      cap.setLatLng([d.moonLat, d.moonLon]);
      cap.setRadius(d.radiusM);
      if (userMarker.dragging) { d.draggable ? userMarker.dragging.enable() : userMarker.dragging.disable(); }
      if (moonMarker.dragging) { d.draggable ? moonMarker.dragging.enable() : moonMarker.dragging.disable(); }
      if (firstFit || d.fit) {
        var bounds = L.latLngBounds([[d.userLat, d.userLon], [d.moonLat, d.moonLon]]);
        map.fitBounds(bounds.pad(0.5), { maxZoom: 5, animate: false });
        firstFit = false;
      }
    };
    // In an iframe, updates arrive via postMessage from the parent.
    window.addEventListener('message', function (ev) {
      try {
        var d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
        if (d && d.type === 'update') window.updateMoon(d);
      } catch (e) {}
    });
    document.title = 'ready';
  </script>
</body>
</html>`;
}

export default function MapPanel({ userLat, userLon, moonLat, moonLon, radiusM, draggable = false, onDragMarker }) {
    const ref = useRef(null);
    const html = useMemo(() => buildHtml(), []);

    const payload = useMemo(
        () => ({ userLat, userLon, moonLat, moonLon, radiusM, draggable }),
        [userLat, userLon, moonLat, moonLon, radiusM, draggable]
    );
    const inject = useMemo(
        () => `window.updateMoon && window.updateMoon(${JSON.stringify(payload)}); true;`,
        [payload]
    );

    // Native: push fresh coordinates into the WebView whenever they change.
    // No-op on web (the WebView ref is never set there).
    useEffect(() => {
        if (Platform.OS !== 'web' && ref.current) ref.current.injectJavaScript(inject);
    }, [inject]);

    // Web: render the same Leaflet HTML inside an iframe and talk to it via
    // postMessage. react-native-webview has no web implementation.
    if (Platform.OS === 'web') {
        return (
            <WebMap
                html={html}
                payload={payload}
                onDragMarker={onDragMarker}
            />
        );
    }

    return (
        <WebView
            ref={ref}
            style={styles.web}
            originWhitelist={['*']}
            source={{ html }}
            injectedJavaScript={inject}
            onLoadEnd={() => ref.current && ref.current.injectJavaScript(inject)}
            onMessage={(e) => {
                try {
                    const m = JSON.parse(e.nativeEvent.data);
                    if (m.type === 'drag' && onDragMarker) onDragMarker(m.kind, m.lat, m.lon);
                } catch (err) {
                    // ignore malformed messages
                }
            }}
            javaScriptEnabled
            domStorageEnabled
        />
    );
}

// Web-only Leaflet map rendered in an iframe.
function WebMap({ html, payload, onDragMarker }) {
    const iframeRef = useRef(null);
    const readyRef = useRef(false);

    const send = () => {
        const win = iframeRef.current && iframeRef.current.contentWindow;
        if (win) win.postMessage({ type: 'update', ...payload }, '*');
    };

    // Listen for drag messages coming back from the iframe.
    useEffect(() => {
        function handle(ev) {
            try {
                const m = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
                if (m && m.type === 'drag' && onDragMarker) onDragMarker(m.kind, m.lat, m.lon);
            } catch (e) {
                // ignore
            }
        }
        window.addEventListener('message', handle);
        return () => window.removeEventListener('message', handle);
    }, [onDragMarker]);

    // Push updates whenever the payload changes (and once the iframe is ready).
    useEffect(() => {
        if (readyRef.current) send();
    }); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <iframe
            ref={iframeRef}
            title="moon-map"
            srcDoc={html}
            style={{ border: 'none', width: '100%', height: '100%', background: '#0b1026' }}
            onLoad={() => {
                readyRef.current = true;
                // Give Leaflet a tick to register its message listener.
                setTimeout(send, 50);
            }}
        />
    );
}

const styles = StyleSheet.create({
    web: { flex: 1, backgroundColor: '#0b1026' },
});
