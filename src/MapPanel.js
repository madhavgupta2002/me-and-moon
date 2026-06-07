// MapPanel.js — keyless map panel rendered inside a WebView.
//
// Two interchangeable views share the same drag/postMessage protocol:
//   • "globe" — a real 3D globe (D3 geoOrthographic). The "closer to the Moon"
//     region is a genuine spherical cap (d3.geoCircle), drawn correctly all the
//     way out to its true radius. Spin by dragging empty space.
//   • "map"   — a flat slippy map (Leaflet + OpenStreetMap tiles), with world
//     wrapping disabled so only a single, non-repeating world is shown.
// In simulator mode the You/Moon pins can be dragged on either view.

import { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet } from 'react-native';

const WebView = Platform.OS === 'web' ? null : require('react-native-webview').WebView;

function buildGlobeHtml() {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <script src="https://unpkg.com/d3@7/dist/d3.min.js"></script>
  <script src="https://unpkg.com/topojson-client@3/dist/topojson-client.min.js"></script>
  <style>
    html, body { height: 100%; margin: 0; padding: 0; background: #070b1f; overflow: hidden; }
    #globe { width: 100%; height: 100%; display: block; touch-action: none; }
    .ocean { fill: #16306b; }
    .oceanEdge { fill: none; stroke: rgba(120,138,220,0.6); stroke-width: 1; }
    .graticule { fill: none; stroke: rgba(120,138,220,0.18); stroke-width: 0.5; }
    .land { fill: #e9e2c8; stroke: #c9bf9a; stroke-width: 0.4; }
    .cap { fill: #ffd24f; fill-opacity: 0.16; stroke: #ffd24f; stroke-width: 1.6; stroke-opacity: 0.95; }
    .mLabel { font: 600 11px -apple-system, system-ui, sans-serif; fill: #f5f7ff; paint-order: stroke; stroke: #070b1f; stroke-width: 3px; stroke-linejoin: round; }
  </style>
</head>
<body>
  <svg id="globe"></svg>
  <script>
    var RN = window.ReactNativeWebView;
    function post(kind, lat, lon) {
      var msg = JSON.stringify({ type: 'drag', kind: kind, lat: lat, lon: lon });
      if (RN) RN.postMessage(msg);
      else if (window.parent !== window) window.parent.postMessage(msg, '*');
    }

    var svg = d3.select('#globe');
    var width = 300, height = 300;
    var projection = d3.geoOrthographic().clipAngle(90).precision(0.4).rotate([0, -20]);
    var path = d3.geoPath(projection);
    var graticule = d3.geoGraticule10();

    // cur = what is drawn this frame; tgt = where we want to be. When animating
    // we ease cur toward tgt along great circles each frame for smooth motion.
    var cur = { userLat: 0, userLon: 0, moonLat: 0, moonLon: 0, radiusDeg: 0 };
    var tgt = { userLat: 0, userLon: 0, moonLat: 0, moonLon: 0, radiusDeg: 0 };
    var animate = false;
    var draggable = false;
    var land = null;
    var inited = false;
    var rafId = null;

    // Layers (drawn back-to-front).
    var oceanPath = svg.append('path').attr('class', 'ocean');
    var gratPath = svg.append('path').attr('class', 'graticule');
    var landPath = svg.append('path').attr('class', 'land');
    var capPath = svg.append('path').attr('class', 'cap');
    var edgePath = svg.append('path').attr('class', 'oceanEdge');

    var userG = svg.append('g');
    userG.append('circle').attr('r', 7).attr('fill', '#5b9dff').attr('stroke', '#fff').attr('stroke-width', 2);
    userG.append('text').attr('class', 'mLabel').attr('x', 11).attr('y', 4).text('You');

    var moonG = svg.append('g');
    moonG.append('circle').attr('r', 7).attr('fill', '#ffd24f').attr('stroke', '#fff').attr('stroke-width', 2);
    moonG.append('text').attr('class', 'mLabel').attr('x', 11).attr('y', 4).text('Moon');

    function resize() {
      var rect = document.getElementById('globe').getBoundingClientRect();
      width = rect.width || 300;
      height = rect.height || 300;
      svg.attr('width', width).attr('height', height);
      var scale = Math.min(width, height) / 2 - 10;
      projection.translate([width / 2, height / 2]).scale(scale);
      render();
    }

    function visible(lon, lat) {
      var r = projection.rotate();
      var center = [-r[0], -r[1]];
      return d3.geoDistance([lon, lat], center) < Math.PI / 2 - 1e-6;
    }

    function placeMarker(g, lon, lat) {
      if (!visible(lon, lat)) { g.style('display', 'none'); return; }
      var p = projection([lon, lat]);
      if (!p) { g.style('display', 'none'); return; }
      g.style('display', null).attr('transform', 'translate(' + p[0] + ',' + p[1] + ')');
    }

    function render() {
      oceanPath.attr('d', path({ type: 'Sphere' }));
      edgePath.attr('d', path({ type: 'Sphere' }));
      gratPath.attr('d', path(graticule));
      if (land) landPath.attr('d', path(land));
      var cap = d3.geoCircle().center([cur.moonLon, cur.moonLat]).radius(cur.radiusDeg)();
      capPath.attr('d', path(cap));
      placeMarker(userG, cur.userLon, cur.userLat);
      placeMarker(moonG, cur.moonLon, cur.moonLat);
    }

    // Smoothly ease cur -> tgt each animation frame (great-circle for points).
    function snap() {
      cur.userLat = tgt.userLat; cur.userLon = tgt.userLon;
      cur.moonLat = tgt.moonLat; cur.moonLon = tgt.moonLon;
      cur.radiusDeg = tgt.radiusDeg;
    }
    function frame() {
      rafId = null;
      var done = true;
      if (animate) {
        var a = 0.2; // easing factor per frame (~smooth at 60fps)
        var u = d3.geoInterpolate([cur.userLon, cur.userLat], [tgt.userLon, tgt.userLat])(a);
        var m = d3.geoInterpolate([cur.moonLon, cur.moonLat], [tgt.moonLon, tgt.moonLat])(a);
        cur.userLon = u[0]; cur.userLat = u[1];
        cur.moonLon = m[0]; cur.moonLat = m[1];
        cur.radiusDeg += (tgt.radiusDeg - cur.radiusDeg) * a;
        if (d3.geoDistance([cur.moonLon, cur.moonLat], [tgt.moonLon, tgt.moonLat]) > 1e-4) done = false;
        if (d3.geoDistance([cur.userLon, cur.userLat], [tgt.userLon, tgt.userLat]) > 1e-4) done = false;
        if (Math.abs(cur.radiusDeg - tgt.radiusDeg) > 1e-3) done = false;
        if (done) snap();
      } else {
        snap();
      }
      render();
      if (!done) rafId = requestAnimationFrame(frame);
    }
    function kick() { if (rafId == null) rafId = requestAnimationFrame(frame); }

    // Center the globe on the midpoint of the two points (computed in 3D).
    function centerOnPair() {
      function toVec(lon, lat) {
        var p = lon * Math.PI / 180, t = lat * Math.PI / 180;
        return [Math.cos(t) * Math.cos(p), Math.cos(t) * Math.sin(p), Math.sin(t)];
      }
      var a = toVec(cur.userLon, cur.userLat);
      var b = toVec(cur.moonLon, cur.moonLat);
      var m = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
      var len = Math.hypot(m[0], m[1], m[2]);
      if (len < 1e-6) { projection.rotate([-cur.moonLon, -cur.moonLat]); return; }
      m = [m[0] / len, m[1] / len, m[2] / len];
      var lon = Math.atan2(m[1], m[0]) * 180 / Math.PI;
      var lat = Math.asin(m[2]) * 180 / Math.PI;
      projection.rotate([-lon, -lat]);
    }

    // --- Dragging: spin the globe, or move a pin in simulator mode. ---
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function nearMarker(px, py) {
      var list = [['moon', cur.moonLon, cur.moonLat], ['user', cur.userLon, cur.userLat]];
      for (var i = 0; i < list.length; i++) {
        var lon = list[i][1], lat = list[i][2];
        if (!visible(lon, lat)) continue;
        var p = projection([lon, lat]);
        if (p && Math.hypot(px - p[0], py - p[1]) < 18) return list[i][0];
      }
      return null;
    }

    var dragTarget = null, x0 = 0, y0 = 0, r0 = [0, 0];
    svg.call(d3.drag()
      .on('start', function (event) {
        dragTarget = draggable ? nearMarker(event.x, event.y) : null;
        if (!dragTarget) { x0 = event.x; y0 = event.y; r0 = projection.rotate(); }
      })
      .on('drag', function (event) {
        if (dragTarget) {
          var ll = projection.invert([event.x, event.y]);
          if (ll && isFinite(ll[0]) && isFinite(ll[1])) {
            if (dragTarget === 'user') { cur.userLon = tgt.userLon = ll[0]; cur.userLat = tgt.userLat = ll[1]; }
            else { cur.moonLon = tgt.moonLon = ll[0]; cur.moonLat = tgt.moonLat = ll[1]; }
            render();
          }
        } else {
          var k = 75 / projection.scale();
          projection.rotate([
            r0[0] + (event.x - x0) * k,
            clamp(r0[1] - (event.y - y0) * k, -90, 90),
          ]);
          render();
        }
      })
      .on('end', function () {
        if (dragTarget === 'user') post('user', cur.userLat, cur.userLon);
        else if (dragTarget === 'moon') post('moon', cur.moonLat, cur.moonLon);
        dragTarget = null;
      }));

    window.updateMoon = function (d) {
      var first = !inited;
      tgt.userLat = d.userLat; tgt.userLon = d.userLon;
      tgt.moonLat = d.moonLat; tgt.moonLon = d.moonLon;
      tgt.radiusDeg = (d.radiusM / 1000) / 6371.0088 * 180 / Math.PI;
      animate = !!d.animate;
      draggable = !!d.draggable;
      if (first) { snap(); centerOnPair(); inited = true; render(); return; }
      if (d.fit) centerOnPair();
      if (animate) kick();
      else { snap(); render(); }
    };

    window.addEventListener('message', function (ev) {
      try {
        var d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
        if (d && d.type === 'update') window.updateMoon(d);
      } catch (e) {}
    });
    window.addEventListener('resize', resize);

    // Load coastlines, then paint.
    fetch('https://unpkg.com/world-atlas@2/land-110m.json')
      .then(function (r) { return r.json(); })
      .then(function (world) { land = topojson.feature(world, world.objects.land); render(); })
      .catch(function () {});

    resize();
    document.title = 'ready';
  </script>
</body>
</html>`;
}

// Flat slippy-map view (Leaflet + OpenStreetMap). World wrapping is disabled so
// only one world is visible — no infinite horizontal repeats.
function buildMapHtml() {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; background: #070b1f; }
    .pin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 6px rgba(0,0,0,0.5); }
    .leaflet-container { background: #16306b; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var RN = window.ReactNativeWebView;
    function post(kind, lat, lon) {
      var msg = JSON.stringify({ type: 'drag', kind: kind, lat: lat, lon: lon });
      if (RN) RN.postMessage(msg);
      else if (window.parent !== window) window.parent.postMessage(msg, '*');
    }

    // Keep the map within a single world: clamp panning and forbid zooming out
    // far enough to reveal a second copy.
    var southWest = L.latLng(-85, -180), northEast = L.latLng(85, 180);
    var worldBounds = L.latLngBounds(southWest, northEast);
    var map = L.map('map', {
      zoomControl: true,
      attributionControl: true,
      worldCopyJump: false,
      maxBounds: worldBounds,
      maxBoundsViscosity: 1.0,
      minZoom: 2,
      maxZoom: 19,
    }).setView([0, 0], 2);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      noWrap: true,
      bounds: worldBounds,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    function pin(color) {
      return L.divIcon({ className: '', html: '<div class="pin" style="background:' + color + '"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
    }

    var userMarker = L.marker([0, 0], { icon: pin('#5b9dff'), draggable: true }).addTo(map).bindTooltip('You');
    var moonMarker = L.marker([0, 0], { icon: pin('#ffd24f'), draggable: true }).addTo(map).bindTooltip('Moon overhead');
    var cap = L.circle([0, 0], { radius: 0, color: '#ffd24f', weight: 2, fillColor: '#ffd24f', fillOpacity: 0.14 }).addTo(map);

    moonMarker.on('drag', function () { cap.setLatLng(moonMarker.getLatLng()); });
    userMarker.on('dragend', function () { post('user', userMarker.getLatLng().lat, userMarker.getLatLng().lng); });
    moonMarker.on('dragend', function () { post('moon', moonMarker.getLatLng().lat, moonMarker.getLatLng().lng); });

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

export default function MapPanel({ userLat, userLon, moonLat, moonLon, radiusM, draggable = false, animate = false, view = 'globe', onDragMarker }) {
    const ref = useRef(null);
    const html = useMemo(() => (view === 'map' ? buildMapHtml() : buildGlobeHtml()), [view]);

    const payload = useMemo(
        () => ({ userLat, userLon, moonLat, moonLon, radiusM, draggable, animate }),
        [userLat, userLon, moonLat, moonLon, radiusM, draggable, animate]
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

    // Web: render the same globe HTML inside an iframe and talk to it via
    // postMessage. react-native-webview has no web implementation.
    if (Platform.OS === 'web') {
        return (
            <WebMap
                key={view}
                html={html}
                payload={payload}
                onDragMarker={onDragMarker}
            />
        );
    }

    return (
        <WebView
            key={view}
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

// Web-only globe rendered in an iframe.
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
            title="moon-globe"
            srcDoc={html}
            style={{ border: 'none', width: '100%', height: '100%', background: '#070b1f' }}
            onLoad={() => {
                readyRef.current = true;
                // Give the globe a tick to register its message listener.
                setTimeout(send, 50);
            }}
        />
    );
}

const styles = StyleSheet.create({
    web: { flex: 1, backgroundColor: '#070b1f' },
});
