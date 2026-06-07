// MapPanel.js — keyless map using Leaflet + OpenStreetMap tiles inside a WebView.
//
// This avoids any Google Maps API key. OpenStreetMap raster tiles are free to
// use (subject to the OSM tile usage policy). The map shows the user, the
// sub-lunar point, and the "circle" (spherical cap) between them.

import { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

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
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', { zoomControl: false, attributionControl: true }).setView([0, 0], 1);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    var userMarker = L.circleMarker([0, 0], { radius: 7, color: '#4f8cff', fillColor: '#4f8cff', fillOpacity: 1 }).addTo(map);
    var moonMarker = L.circleMarker([0, 0], { radius: 7, color: '#ffd24f', fillColor: '#ffd24f', fillOpacity: 1 }).addTo(map);
    var cap = L.circle([0, 0], { radius: 0, color: '#ffd24f', weight: 2, fillColor: '#ffd24f', fillOpacity: 0.12 }).addTo(map);
    userMarker.bindTooltip('You');
    moonMarker.bindTooltip('Moon overhead');

    window.updateMoon = function (d) {
      userMarker.setLatLng([d.userLat, d.userLon]);
      moonMarker.setLatLng([d.moonLat, d.moonLon]);
      cap.setLatLng([d.moonLat, d.moonLon]);
      cap.setRadius(d.radiusM);
      var bounds = L.latLngBounds([[d.userLat, d.userLon], [d.moonLat, d.moonLon]]);
      map.fitBounds(bounds.pad(0.5), { maxZoom: 5, animate: false });
    };
    document.title = 'ready';
  </script>
</body>
</html>`;
}

export default function MapPanel({ userLat, userLon, moonLat, moonLon, radiusM }) {
    const ref = useRef(null);
    const html = useMemo(() => buildHtml(), []);

    const inject = useMemo(() => {
        const payload = JSON.stringify({ userLat, userLon, moonLat, moonLon, radiusM });
        return `window.updateMoon && window.updateMoon(${payload}); true;`;
    }, [userLat, userLon, moonLat, moonLon, radiusM]);

    // Push fresh coordinates into the WebView whenever they change.
    useEffect(() => {
        if (Platform.OS !== 'web' && ref.current) {
            ref.current.injectJavaScript(inject);
        }
    }, [inject]);

    if (Platform.OS === 'web') {
        return (
            <View style={[styles.fallback, styles.center]}>
                <Text style={styles.fallbackText}>Map preview is available on the mobile app.</Text>
            </View>
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
            javaScriptEnabled
            domStorageEnabled
        />
    );
}

const styles = StyleSheet.create({
    web: { flex: 1, backgroundColor: '#0b1026' },
    fallback: { flex: 1, backgroundColor: '#161d3d' },
    center: { alignItems: 'center', justifyContent: 'center' },
    fallbackText: { color: '#9aa4d4', textAlign: 'center', padding: 16 },
});
