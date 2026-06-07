import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';

import { getSubLunarPoint } from './src/moon';
import { surfaceDistanceKm, userToMoonDistanceKm } from './src/geo';
import { computeRank } from './src/rank';
import MapPanel from './src/MapPanel';
import citiesData from './assets/cities.json';

const MOON_REFRESH_MS = 1000;

function formatNumber(n) {
  return Math.round(n).toLocaleString();
}

function formatCoord(value, posLabel, negLabel) {
  const dir = value >= 0 ? posLabel : negLabel;
  return `${Math.abs(value).toFixed(4)}° ${dir}`;
}

export default function App() {
  const [mode, setMode] = useState('live'); // live | sim
  const [permission, setPermission] = useState('pending'); // pending | granted | denied
  const [coords, setCoords] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [errorMsg, setErrorMsg] = useState('');
  const [simUser, setSimUser] = useState({ lat: 20, lon: 0 });
  const [simMoon, setSimMoon] = useState({ lat: 0, lon: 0 });
  const watcherRef = useRef(null);

  // Request permission and start watching GPS.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setPermission('denied');
        return;
      }
      setPermission('granted');
      try {
        watcherRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 3000,
            distanceInterval: 5,
          },
          (loc) => setCoords(loc.coords)
        );
      } catch (e) {
        setErrorMsg(String(e?.message ?? e));
      }
    })();

    return () => {
      cancelled = true;
      if (watcherRef.current) {
        watcherRef.current.remove();
        watcherRef.current = null;
      }
    };
  }, []);

  // Tick the clock so the Moon position keeps updating. Paused in simulator
  // mode so manual drags are not overwritten.
  useEffect(() => {
    if (mode !== 'live') return undefined;
    const id = setInterval(() => setNow(new Date()), MOON_REFRESH_MS);
    return () => clearInterval(id);
  }, [mode]);

  // Seed simulator positions from the live values when entering sim mode.
  function enterSimulator() {
    const live = getSubLunarPoint(new Date());
    setSimMoon({ lat: +live.lat.toFixed(2), lon: +live.lon.toFixed(2) });
    if (coords) {
      setSimUser({ lat: +coords.latitude.toFixed(2), lon: +coords.longitude.toFixed(2) });
    }
    setMode('sim');
  }

  function handleDragMarker(kind, lat, lon) {
    const next = { lat: +lat.toFixed(4), lon: +lon.toFixed(4) };
    if (kind === 'user') setSimUser(next);
    else setSimMoon(next);
  }

  function resetMoonToLive() {
    const live = getSubLunarPoint(new Date());
    setSimMoon({ lat: +live.lat.toFixed(2), lon: +live.lon.toFixed(2) });
  }

  // Derived values. In sim mode positions come from the draggable markers; the
  // Earth-Moon distance still uses the real current Moon distance.
  const liveSub = getSubLunarPoint(now);
  const moonDistanceKm = liveSub.distanceKm;
  const isSim = mode === 'sim';

  const displayUser = isSim
    ? simUser
    : coords
      ? { lat: coords.latitude, lon: coords.longitude }
      : null;
  const displayMoon = isSim ? simMoon : { lat: liveSub.lat, lon: liveSub.lon };

  let result = null;
  if (displayUser && displayMoon) {
    const ranking = computeRank(
      displayUser.lat,
      displayUser.lon,
      displayMoon.lat,
      displayMoon.lon,
      citiesData
    );
    const moonKm = userToMoonDistanceKm(ranking.userAngularDeg, moonDistanceKm);
    const groundKm = surfaceDistanceKm(
      displayUser.lat,
      displayUser.lon,
      displayMoon.lat,
      displayMoon.lon
    );
    result = { ranking, moonKm, groundKm };
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>🌙 moon &amp; me</Text>
        <Text style={styles.subtitle}>How close are you to the Moon, right now?</Text>

        <View style={styles.toggleRow}>
          <Text
            style={[styles.toggleBtn, !isSim && styles.toggleBtnActive]}
            onPress={() => setMode('live')}
          >
            📍 Live GPS
          </Text>
          <Text
            style={[styles.toggleBtn, isSim && styles.toggleBtnActive]}
            onPress={enterSimulator}
          >
            🧪 Simulator
          </Text>
        </View>

        {isSim && (
          <View style={styles.card}>
            <Text style={styles.simHint}>
              Drag the blue (you) and yellow (Moon) pins on the map to test any
              position. The rank updates instantly.
            </Text>
            <Text style={styles.resetBtn} onPress={resetMoonToLive}>
              Reset Moon to real position
            </Text>
          </View>
        )}

        {mode === 'live' && permission === 'pending' && (
          <View style={styles.card}>
            <ActivityIndicator color="#cbd5ff" />
            <Text style={styles.muted}>Requesting location permission…</Text>
          </View>
        )}

        {mode === 'live' && permission === 'denied' && (
          <View style={styles.card}>
            <Text style={styles.error}>
              Location permission denied. Enable it in settings, or try Simulator
              mode.
            </Text>
          </View>
        )}

        {mode === 'live' && permission === 'granted' && !coords && (
          <View style={styles.card}>
            <ActivityIndicator color="#cbd5ff" />
            <Text style={styles.muted}>Getting your GPS fix…</Text>
          </View>
        )}

        {errorMsg ? (
          <View style={styles.card}>
            <Text style={styles.error}>{errorMsg}</Text>
          </View>
        ) : null}

        {result && displayUser && (
          <>
            <View style={styles.rankCard}>
              <Text style={styles.rankLabel}>
                {isSim ? 'SIMULATED RANK' : 'YOUR RANK'}
              </Text>
              <Text style={styles.rankValue}>#{formatNumber(result.ranking.rank)}</Text>
              <Text style={styles.rankSub}>
                closer than {(100 - result.ranking.percentileCloser * 100).toFixed(2)}% of
                ~{formatNumber(result.ranking.totalPopulation)} people
              </Text>
            </View>

            <View style={styles.card}>
              <Row label="Distance to Moon" value={`${formatNumber(result.moonKm)} km`} />
              <Row
                label="You → sub-lunar point"
                value={`${formatNumber(result.groundKm)} km (${result.ranking.userAngularDeg.toFixed(2)}°)`}
              />
              <Row
                label={isSim ? 'Simulated position' : 'Your position'}
                value={`${formatCoord(displayUser.lat, 'N', 'S')}, ${formatCoord(displayUser.lon, 'E', 'W')}`}
              />
              <Row
                label="Moon overhead at"
                value={`${formatCoord(displayMoon.lat, 'N', 'S')}, ${formatCoord(displayMoon.lon, 'E', 'W')}`}
              />
              <Row
                label="People closer than you"
                value={formatNumber(result.ranking.closerPopulation)}
              />
            </View>

            <View style={styles.mapCard}>
              <MapPanel
                userLat={displayUser.lat}
                userLon={displayUser.lon}
                moonLat={displayMoon.lat}
                moonLon={displayMoon.lon}
                radiusM={result.groundKm * 1000}
                draggable={isSim}
                onDragMarker={handleDragMarker}
              />
            </View>
          </>
        )}

        <Text style={styles.footnote}>
          Population from SimpleMaps World Cities (CC BY 4.0). Ranking covers
          ~{formatNumber(citiesData.totalPopulation)} people in {citiesData.count} places.
        </Text>
      </ScrollView>
    </View>
  );
}

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0b1026',
  },
  scroll: {
    padding: 20,
    paddingTop: 64,
    gap: 16,
  },
  title: {
    color: '#f5f7ff',
    fontSize: 34,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: '#9aa4d4',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  toggleBtn: {
    flex: 1,
    textAlign: 'center',
    color: '#9aa4d4',
    backgroundColor: '#161d3d',
    paddingVertical: 12,
    borderRadius: 14,
    overflow: 'hidden',
    fontWeight: '700',
    borderWidth: 1,
    borderColor: '#2d3a7a',
  },
  toggleBtnActive: {
    color: '#0b1026',
    backgroundColor: '#ffd24f',
    borderColor: '#ffd24f',
  },
  simHint: {
    color: '#cbd5ff',
    fontSize: 14,
    lineHeight: 20,
  },
  resetBtn: {
    color: '#ffd24f',
    fontWeight: '700',
    paddingTop: 4,
  },
  card: {
    backgroundColor: '#161d3d',
    borderRadius: 18,
    padding: 18,
    gap: 10,
  },
  rankCard: {
    backgroundColor: '#1b2350',
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2d3a7a',
  },
  rankLabel: {
    color: '#9aa4d4',
    fontSize: 13,
    letterSpacing: 2,
    fontWeight: '700',
  },
  rankValue: {
    color: '#ffd24f',
    fontSize: 52,
    fontWeight: '900',
    marginVertical: 4,
  },
  rankSub: {
    color: '#cbd5ff',
    fontSize: 14,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  rowLabel: {
    color: '#9aa4d4',
    fontSize: 14,
    flexShrink: 1,
  },
  rowValue: {
    color: '#f5f7ff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
    flexShrink: 1,
  },
  mapCard: {
    height: 320,
    borderRadius: 18,
    overflow: 'hidden',
  },
  muted: {
    color: '#9aa4d4',
    textAlign: 'center',
  },
  error: {
    color: '#ff8b8b',
    textAlign: 'center',
  },
  footnote: {
    color: '#5b6493',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
  },
});