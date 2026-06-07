import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
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

// How often the time-travel clock advances while playing. Kept short so the
// globe receives frequent samples; the globe itself eases between them so the
// Moon glides smoothly rather than jumping.
const TIME_SIM_TICK_MS = 120;

// Speed presets: how many simulated seconds pass per real second.
const TIME_SPEEDS = [
  { label: '1×', value: 1 },
  { label: '1 min/s', value: 60 },
  { label: '1 hr/s', value: 3600 },
  { label: '6 hr/s', value: 21600 },
  { label: '1 day/s', value: 86400 },
  { label: '1 wk/s', value: 604800 },
];

// Continuous speed range for the slider (simulated seconds per real second).
// Mapped on a log scale so the lower presets get as much travel as the high
// ones — otherwise everything below "1 day/s" would crowd into a sliver.
const SPEED_MIN = 1;
const SPEED_MAX = 604800;

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Format an arbitrary speed multiplier into a readable rate.
function formatSpeed(v) {
  if (v < 60) return `${Math.round(v)}× real time`;
  const units = [
    { s: 604800, u: 'wk' },
    { s: 86400, u: 'day' },
    { s: 3600, u: 'hr' },
    { s: 60, u: 'min' },
  ];
  for (let i = 0; i < units.length; i += 1) {
    if (v >= units[i].s) {
      const n = v / units[i].s;
      const str = n >= 10 ? Math.round(n).toString() : n.toFixed(1);
      return `${str} ${units[i].u}/s`;
    }
  }
  return `${Math.round(v)}× real time`;
}

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

function formatSimDateTime(date) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    }).format(date);
  } catch (e) {
    return date.toString();
  }
}

// Compact clock for the overlay bar (no weekday / timezone).
function formatSimClock(date) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  } catch (e) {
    return date.toString();
  }
}

// Cosmic palette — semantic tokens used across the screen.
const C = {
  bg: '#070b1f',
  bgDeep: '#04060f',
  surface: 'rgba(28, 36, 74, 0.55)',
  surfaceSolid: '#141b3c',
  border: 'rgba(120, 138, 220, 0.18)',
  borderBright: 'rgba(255, 210, 79, 0.45)',
  accent: '#ffd24f',
  accentSoft: '#ffe9a8',
  user: '#5b9dff',
  text: '#f5f7ff',
  muted: '#9aa4d4',
  faint: '#5b6493',
  danger: '#ff8b8b',
};

function formatNumber(n) {
  return Math.round(n).toLocaleString();
}

function formatCoord(value, posLabel, negLabel) {
  const dir = value >= 0 ? posLabel : negLabel;
  return `${Math.abs(value).toFixed(4)}° ${dir}`;
}

// A cheap, deterministic starfield so the background feels alive without assets.
function useStars(count, width, height) {
  return useMemo(() => {
    const stars = [];
    let seed = 1337;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < count; i += 1) {
      stars.push({
        left: rand() * width,
        top: rand() * height,
        size: rand() < 0.85 ? 1.5 : 2.5,
        opacity: 0.25 + rand() * 0.6,
      });
    }
    return stars;
  }, [count, width, height]);
}

export default function App() {
  const [mode, setMode] = useState('live'); // live | sim
  const [permission, setPermission] = useState('pending'); // pending | granted | denied
  const [coords, setCoords] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [errorMsg, setErrorMsg] = useState('');
  const [simUser, setSimUser] = useState({ lat: 20, lon: 0 });
  const [simMoon, setSimMoon] = useState({ lat: 0, lon: 0 });
  // Time-travel simulation: when active, the Moon position is driven by a
  // simulated clock instead of dragging, so drag is disabled.
  const [timeSim, setTimeSim] = useState(false);
  const [timePlaying, setTimePlaying] = useState(true);
  const [timeSpeed, setTimeSpeed] = useState(3600);
  const [simDate, setSimDate] = useState(() => new Date());
  // Which map renderer to show: a 3D globe or a flat (non-repeating) map.
  const [mapView, setMapView] = useState('globe'); // globe | map
  const watcherRef = useRef(null);
  const { width } = useWindowDimensions();
  const stars = useStars(70, width, 320);

  // Gentle pulsing glow behind the moon glyph.
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [glow]);
  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });

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

  // Advance the time-travel clock while it is enabled and playing. Each tick
  // adds `timeSpeed` simulated seconds per real second.
  useEffect(() => {
    if (!(mode === 'sim' && timeSim && timePlaying)) return undefined;
    const id = setInterval(() => {
      setSimDate((d) => new Date(d.getTime() + timeSpeed * TIME_SIM_TICK_MS));
    }, TIME_SIM_TICK_MS);
    return () => clearInterval(id);
  }, [mode, timeSim, timePlaying, timeSpeed]);

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

  // Turn time-travel on/off. Enabling it seeds the simulated clock from now.
  function toggleTimeSim() {
    setTimeSim((on) => {
      if (!on) {
        setSimDate(new Date());
        setTimePlaying(true);
      }
      return !on;
    });
  }

  function jumpSimTime(deltaMs) {
    setSimDate((d) => new Date(d.getTime() + deltaMs));
  }

  function resetSimTimeToNow() {
    setSimDate(new Date());
  }

  // Derived values. In sim mode positions come from the draggable markers; the
  // Earth-Moon distance still uses the real current Moon distance. When the
  // time-travel clock is active, the Moon position and distance are computed
  // from the simulated date instead, and dragging is disabled.
  const liveSub = getSubLunarPoint(now);
  const isSim = mode === 'sim';
  const timeActive = isSim && timeSim;
  const simSub = useMemo(
    () => (timeActive ? getSubLunarPoint(simDate) : null),
    [timeActive, simDate]
  );

  const moonDistanceKm = timeActive ? simSub.distanceKm : liveSub.distanceKm;
  const dragEnabled = isSim && !timeActive;

  const displayUser = isSim
    ? simUser
    : coords
      ? { lat: coords.latitude, lon: coords.longitude }
      : null;
  const displayMoon = timeActive
    ? { lat: simSub.lat, lon: simSub.lon }
    : isSim
      ? simMoon
      : { lat: liveSub.lat, lon: liveSub.lon };

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
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero with starfield + animated moon */}
        <View style={styles.hero}>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {stars.map((s, i) => (
              <View
                key={i}
                style={[
                  styles.star,
                  { left: s.left, top: s.top, width: s.size, height: s.size, opacity: s.opacity },
                ]}
              />
            ))}
          </View>

          <View style={styles.moonWrap}>
            <Animated.View
              style={[
                styles.moonGlow,
                { opacity: glowOpacity, transform: [{ scale: glowScale }] },
              ]}
            />
            <View style={styles.moon}>
              <View style={[styles.crater, { top: 14, left: 18, width: 14, height: 14 }]} />
              <View style={[styles.crater, { top: 34, left: 40, width: 9, height: 9 }]} />
              <View style={[styles.crater, { top: 44, left: 16, width: 7, height: 7 }]} />
              <View style={styles.moonShadow} />
            </View>
          </View>

          <Text style={styles.title}>moon &amp; me</Text>
          <Text style={styles.subtitle}>How close are you to the Moon, right now?</Text>
        </View>

        {/* Segmented control */}
        <View style={styles.segment}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: !isSim }}
            accessibilityLabel="Use live GPS location"
            style={({ pressed }) => [
              styles.segmentBtn,
              !isSim && styles.segmentBtnActive,
              pressed && styles.pressed,
            ]}
            onPress={() => setMode('live')}
          >
            <Text style={[styles.segmentText, !isSim && styles.segmentTextActive]}>
              Live GPS
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: isSim }}
            accessibilityLabel="Open the position simulator"
            style={({ pressed }) => [
              styles.segmentBtn,
              isSim && styles.segmentBtnActive,
              pressed && styles.pressed,
            ]}
            onPress={enterSimulator}
          >
            <Text style={[styles.segmentText, isSim && styles.segmentTextActive]}>
              Simulator
            </Text>
          </Pressable>
        </View>

        {isSim && (
          <View style={styles.card}>
            <Text style={styles.simHint}>
              {timeActive
                ? 'Time-travel is on: the Moon follows the simulated clock, so map dragging is paused. Drag empty space to spin the globe.'
                : 'Drag the blue (you) and yellow (Moon) pins on the globe to test any position. Drag empty space to spin it. The rank updates instantly.'}
            </Text>
            {!timeActive && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reset Moon to its real position"
                style={({ pressed }) => [styles.resetBtn, pressed && styles.pressed]}
                onPress={resetMoonToLive}
              >
                <Text style={styles.resetBtnText}>↺  Reset Moon to real position</Text>
              </Pressable>
            )}
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
              {(() => {
                const closerPct = 100 - result.ranking.percentileCloser * 100;
                return (
                  <>
                    <Text style={styles.rankSub}>
                      closer than{' '}
                      <Text style={styles.rankSubStrong}>{closerPct.toFixed(2)}%</Text> of
                      ~{formatNumber(result.ranking.totalPopulation)} people
                    </Text>
                    <View style={styles.meterTrack}>
                      <View
                        style={[
                          styles.meterFill,
                          { width: `${Math.max(2, Math.min(100, closerPct))}%` },
                        ]}
                      />
                    </View>
                  </>
                );
              })()}
            </View>

            <View style={styles.statGrid}>
              <Stat label="Distance to Moon" value={formatNumber(result.moonKm)} unit="km" />
              <Stat
                label="Ground to sub-lunar"
                value={formatNumber(result.groundKm)}
                unit={`km · ${result.ranking.userAngularDeg.toFixed(1)}°`}
              />
            </View>

            <View style={styles.card}>
              <Row
                label={isSim ? 'Simulated position' : 'Your position'}
                value={`${formatCoord(displayUser.lat, 'N', 'S')}, ${formatCoord(displayUser.lon, 'E', 'W')}`}
              />
              <View style={styles.divider} />
              <Row
                label="Moon overhead at"
                value={`${formatCoord(displayMoon.lat, 'N', 'S')}, ${formatCoord(displayMoon.lon, 'E', 'W')}`}
              />
              {timeActive && (
                <>
                  <View style={styles.divider} />
                  <Row label="Simulated time" value={formatSimDateTime(simDate)} />
                </>
              )}
              <View style={styles.divider} />
              <Row
                label="People closer than you"
                value={formatNumber(result.ranking.closerPopulation)}
              />
            </View>

            <View style={styles.viewToggle}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: mapView === 'globe' }}
                accessibilityLabel="Show 3D globe view"
                onPress={() => setMapView('globe')}
                style={({ pressed }) => [
                  styles.viewToggleBtn,
                  mapView === 'globe' && styles.viewToggleBtnActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.viewToggleText, mapView === 'globe' && styles.viewToggleTextActive]}>
                  🌐  Globe
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: mapView === 'map' }}
                accessibilityLabel="Show flat map view"
                onPress={() => setMapView('map')}
                style={({ pressed }) => [
                  styles.viewToggleBtn,
                  mapView === 'map' && styles.viewToggleBtnActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.viewToggleText, mapView === 'map' && styles.viewToggleTextActive]}>
                  🗺  Map
                </Text>
              </Pressable>
            </View>

            <View style={styles.mapCard}>
              <MapPanel
                userLat={displayUser.lat}
                userLon={displayUser.lon}
                moonLat={displayMoon.lat}
                moonLon={displayMoon.lon}
                radiusM={result.groundKm * 1000}
                draggable={dragEnabled}
                animate={timeActive}
                view={mapView}
                onDragMarker={handleDragMarker}
              />
              {isSim && (
                <TimeTravelControls
                  enabled={timeSim}
                  playing={timePlaying}
                  speed={timeSpeed}
                  simDate={simDate}
                  speeds={TIME_SPEEDS}
                  onToggle={toggleTimeSim}
                  onPlayPause={() => setTimePlaying((p) => !p)}
                  onNow={resetSimTimeToNow}
                  onJump={jumpSimTime}
                  onSpeed={setTimeSpeed}
                  jumps={[
                    { label: '-1d', ms: -DAY_MS },
                    { label: '-1h', ms: -HOUR_MS },
                    { label: '+1h', ms: HOUR_MS },
                    { label: '+1d', ms: DAY_MS },
                    { label: '+7d', ms: 7 * DAY_MS },
                  ]}
                />
              )}
            </View>
          </>
        )}

        <Text style={styles.footnote}>
          Population from WorldPop global grid (~1 km, downsampled). Ranking covers
          ~{formatNumber(citiesData.totalPopulation)} people across {formatNumber(citiesData.count)} grid cells.
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

function Stat({ label, value, unit }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>
        {value} <Text style={styles.statUnit}>{unit}</Text>
      </Text>
    </View>
  );
}

// Log-scale speed slider. Built on PanResponder so it works the same on web
// and native without an extra dependency. The thumb can be dragged anywhere
// along the track for any speed between SPEED_MIN and SPEED_MAX.
function SpeedSlider({ value, min, max, onChange }) {
  const [width, setWidth] = useState(0);
  const geom = useRef({ left: 0, width: 1 });
  const trackRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const lnMin = Math.log(min);
  const lnMax = Math.log(max);
  const toFrac = (v) => clamp01((Math.log(v) - lnMin) / (lnMax - lnMin));
  const toVal = (f) => Math.exp(lnMin + (lnMax - lnMin) * clamp01(f));

  const measure = () => {
    if (trackRef.current && trackRef.current.measureInWindow) {
      trackRef.current.measureInWindow((x, y, w) => {
        geom.current = { left: x, width: w || 1 };
      });
    }
  };

  const setFromX = (pageX) => {
    const { left, width: w } = geom.current;
    onChangeRef.current(toVal((pageX - left) / w));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        measure();
        setFromX(evt.nativeEvent.pageX);
      },
      onPanResponderMove: (evt) => setFromX(evt.nativeEvent.pageX),
    })
  ).current;

  const frac = toFrac(value);
  const thumbLeft = Math.max(0, Math.min(width, frac * width));

  return (
    <View
      ref={trackRef}
      onLayout={(e) => {
        setWidth(e.nativeEvent.layout.width);
        measure();
      }}
      style={styles.sliderHit}
      accessibilityRole="adjustable"
      accessibilityLabel="Time-travel speed"
      {...pan.panHandlers}
    >
      <View style={styles.sliderTrack}>
        <View style={[styles.sliderFill, { width: thumbLeft }]} />
      </View>
      <View style={[styles.sliderThumb, { left: thumbLeft - 9 }]} />
    </View>
  );
}

// Hover-to-expand time-travel controls pinned to the bottom of the globe pane.
// Collapsed it is a slim bar (clock + play/pause); hovering (or tapping the
// chevron) slides out the speed presets and time-jump shortcuts.
function TimeTravelControls({
  enabled,
  playing,
  speed,
  simDate,
  speeds,
  jumps,
  onToggle,
  onPlayPause,
  onNow,
  onJump,
  onSpeed,
}) {
  const [expanded, setExpanded] = useState(false);
  const reveal = useRef(new Animated.Value(0)).current;
  const collapseTimer = useRef(null);

  useEffect(() => {
    Animated.timing(reveal, {
      toValue: expanded && enabled ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [expanded, enabled, reveal]);

  useEffect(
    () => () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    },
    []
  );

  // Collapsing on hover-out is debounced so moving the pointer from the bar to
  // the panel (or between buttons) does not flicker the panel shut.
  const open = () => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
    setExpanded(true);
  };
  const closeSoon = () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => setExpanded(false), 90);
  };

  const panelTranslate = reveal.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  const chevronRotate = reveal.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Pressable
        onHoverIn={enabled ? open : undefined}
        onHoverOut={enabled ? closeSoon : undefined}
        onPress={() => {
          if (!enabled) onToggle();
        }}
        style={styles.ttSurface}
      >
        {enabled && (
          <Animated.View
            pointerEvents={expanded ? 'auto' : 'none'}
            style={[styles.ttPanel, { opacity: reveal, transform: [{ translateY: panelTranslate }] }]}
          >
            <View style={styles.ttSpeedHeader}>
              <Text style={styles.ttSectionLabel}>Speed</Text>
              <Text style={styles.ttSpeedValue}>{formatSpeed(speed)}</Text>
            </View>
            <SpeedSlider value={speed} min={SPEED_MIN} max={SPEED_MAX} onChange={onSpeed} />
            <View style={styles.ttChipRow}>
              {speeds.map((s) => (
                <Pressable
                  key={s.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: speed === s.value }}
                  accessibilityLabel={`Speed ${s.label}`}
                  onPress={() => onSpeed(s.value)}
                  style={({ pressed }) => [
                    styles.ttChip,
                    speed === s.value && styles.ttChipActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.ttChipText, speed === s.value && styles.ttChipTextActive]}>
                    {s.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.ttSectionLabel}>Jump</Text>
            <View style={styles.ttChipRow}>
              {jumps.map((j) => (
                <Pressable
                  key={j.label}
                  accessibilityRole="button"
                  accessibilityLabel={`Jump ${j.label}`}
                  onPress={() => onJump(j.ms)}
                  style={({ pressed }) => [styles.ttChip, pressed && styles.pressed]}
                >
                  <Text style={styles.ttChipText}>{j.label}</Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reset clock to now"
                onPress={onNow}
                style={({ pressed }) => [styles.ttChip, pressed && styles.pressed]}
              >
                <Text style={styles.ttChipText}>Now</Text>
              </Pressable>
            </View>
          </Animated.View>
        )}

        <View style={styles.ttBar}>
          {!enabled ? (
            <Text style={styles.ttEnableText}>⏱  Enable time travel</Text>
          ) : (
            <>
              <View style={styles.ttBarLeft}>
                <Text style={styles.ttClock} numberOfLines={1}>
                  {formatSimClock(simDate)}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={playing ? 'Pause time' : 'Play time'}
                hitSlop={8}
                onPress={onPlayPause}
                style={({ pressed }) => [styles.ttPlay, pressed && styles.pressed]}
              >
                <Text style={styles.ttPlayText}>{playing ? '❚❚' : '▶'}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Turn off time travel"
                hitSlop={8}
                onPress={onToggle}
                style={({ pressed }) => [styles.ttOff, pressed && styles.pressed]}
              >
                <Text style={styles.ttOffText}>OFF</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={expanded ? 'Collapse controls' : 'Expand controls'}
                hitSlop={8}
                onPress={() => setExpanded((e) => !e)}
                style={styles.ttChevronBtn}
              >
                <Animated.Text style={[styles.ttChevron, { transform: [{ rotate: chevronRotate }] }]}>
                  ⌃
                </Animated.Text>
              </Pressable>
            </>
          )}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  scroll: {
    padding: 20,
    paddingTop: 64,
    paddingBottom: 48,
    gap: 16,
  },

  // Hero
  hero: {
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 4,
  },
  star: {
    position: 'absolute',
    borderRadius: 2,
    backgroundColor: '#dfe6ff',
  },
  moonWrap: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  moonGlow: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: C.accent,
    shadowColor: C.accent,
    shadowOpacity: 0.9,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 0 },
  },
  moon: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#f4ecd0',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#fff7e0',
  },
  moonShadow: {
    position: 'absolute',
    right: -26,
    top: -8,
    width: 86,
    height: 94,
    borderRadius: 47,
    backgroundColor: 'rgba(7, 11, 31, 0.55)',
  },
  crater: {
    position: 'absolute',
    borderRadius: 12,
    backgroundColor: 'rgba(180, 168, 130, 0.55)',
  },
  title: {
    color: C.text,
    fontSize: 34,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  subtitle: {
    color: C.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 6,
  },

  // Segmented control
  segment: {
    flexDirection: 'row',
    backgroundColor: 'rgba(20, 27, 60, 0.7)',
    borderRadius: 16,
    padding: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  segmentBtn: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  segmentBtnActive: {
    backgroundColor: C.accent,
    shadowColor: C.accent,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  segmentText: {
    color: C.muted,
    fontWeight: '700',
    fontSize: 15,
  },
  segmentTextActive: {
    color: C.bgDeep,
  },
  pressed: {
    opacity: 0.7,
  },

  // Sim hint
  simHint: {
    color: '#cbd5ff',
    fontSize: 14,
    lineHeight: 20,
  },
  resetBtn: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 8,
  },
  resetBtnText: {
    color: C.accent,
    fontWeight: '700',
    fontSize: 15,
  },

  // Time-travel overlay (hover controls pinned to the bottom of the globe).
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
  },
  ttSurface: {
    justifyContent: 'flex-end',
  },
  ttBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(7, 11, 31, 0.86)',
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  ttEnableText: {
    flex: 1,
    textAlign: 'center',
    color: C.accent,
    fontWeight: '800',
    fontSize: 15,
  },
  ttBarLeft: {
    flex: 1,
  },
  ttClock: {
    color: C.accentSoft,
    fontWeight: '800',
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  ttPlay: {
    minWidth: 42,
    height: 32,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: C.accent,
  },
  ttPlayText: {
    color: C.bgDeep,
    fontWeight: '900',
    fontSize: 13,
  },
  ttOff: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(20, 27, 60, 0.85)',
    borderWidth: 1,
    borderColor: C.border,
  },
  ttOffText: {
    color: C.muted,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 1,
  },
  ttChevron: {
    width: 18,
    textAlign: 'center',
    color: C.muted,
    fontSize: 16,
    fontWeight: '900',
  },
  ttChevronBtn: {
    paddingHorizontal: 2,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ttPanel: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 8,
    backgroundColor: 'rgba(7, 11, 31, 0.92)',
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  ttSectionLabel: {
    color: C.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  ttSpeedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ttSpeedValue: {
    color: C.accentSoft,
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  sliderHit: {
    height: 28,
    justifyContent: 'center',
    marginVertical: 2,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
  },
  sliderTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(120, 138, 220, 0.25)',
    overflow: 'hidden',
  },
  sliderFill: {
    height: 6,
    borderRadius: 999,
    backgroundColor: C.accent,
  },
  sliderThumb: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.accent,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  ttChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ttChip: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(20, 27, 60, 0.85)',
    borderWidth: 1,
    borderColor: C.border,
  },
  ttChipActive: {
    backgroundColor: C.accent,
    borderColor: C.borderBright,
  },
  ttChipText: {
    color: C.muted,
    fontWeight: '700',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  ttChipTextActive: {
    color: C.bgDeep,
  },

  // Generic glass card
  card: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  divider: {
    height: 1,
    backgroundColor: C.border,
  },

  // Rank hero card
  rankCard: {
    backgroundColor: 'rgba(27, 35, 80, 0.65)',
    borderRadius: 26,
    padding: 28,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: C.borderBright,
    shadowColor: C.accent,
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  rankLabel: {
    color: C.muted,
    fontSize: 12,
    letterSpacing: 3,
    fontWeight: '700',
  },
  rankValue: {
    color: C.accent,
    fontSize: 60,
    fontWeight: '900',
    marginVertical: 2,
    textShadowColor: 'rgba(255, 210, 79, 0.4)',
    textShadowRadius: 20,
    textShadowOffset: { width: 0, height: 0 },
  },
  rankSub: {
    color: '#cbd5ff',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  rankSubStrong: {
    color: C.accentSoft,
    fontWeight: '800',
  },
  meterTrack: {
    width: '100%',
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(7, 11, 31, 0.6)',
    overflow: 'hidden',
    marginTop: 12,
  },
  meterFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: C.accent,
  },

  // Stat grid
  statGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  statLabel: {
    color: C.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  statValue: {
    color: C.text,
    fontSize: 22,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  statUnit: {
    color: C.muted,
    fontSize: 12,
    fontWeight: '600',
  },

  // Data rows
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  rowLabel: {
    color: C.muted,
    fontSize: 14,
    flexShrink: 1,
  },
  rowValue: {
    color: C.text,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
    flexShrink: 1,
    fontVariant: ['tabular-nums'],
  },

  // Map
  viewToggle: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: 'rgba(20, 27, 60, 0.7)',
    borderRadius: 12,
    padding: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  viewToggleBtn: {
    minHeight: 36,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 9,
  },
  viewToggleBtnActive: {
    backgroundColor: C.accent,
  },
  viewToggleText: {
    color: C.muted,
    fontWeight: '700',
    fontSize: 14,
  },
  viewToggleTextActive: {
    color: C.bgDeep,
  },
  mapCard: {
    height: 320,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
  },

  // States
  muted: {
    color: C.muted,
    textAlign: 'center',
  },
  error: {
    color: C.danger,
    textAlign: 'center',
    lineHeight: 20,
  },
  footnote: {
    color: C.faint,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 8,
  },
});