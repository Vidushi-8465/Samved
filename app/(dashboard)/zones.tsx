// app/(dashboard)/zones.tsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';
import {
  SOLAPUR_ZONES,
  SOLAPUR_MANHOLES,
  getSafetyStatus,
} from '@/services/sensorService';

// ─── Constants ────────────────────────────────────────────────────────────────

const SOLAPUR_LAT = 17.6869;
const SOLAPUR_LNG = 75.9064;

// Open-Meteo free API — no key required, supports CORS
const WEATHER_API_URL =
  `https://api.open-meteo.com/v1/forecast` +
  `?latitude=${SOLAPUR_LAT}` +
  `&longitude=${SOLAPUR_LNG}` +
  `&current=temperature_2m,relative_humidity_2m,precipitation,windspeed_10m,weathercode` +
  `&timezone=Asia%2FKolkata` +
  `&forecast_days=1`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface WeatherData {
  temp: number;
  humidity: number;
  rain: number;
  windspeed: number;
  weathercode: number;
  description: string;
  fetchedAt: string; // ISO timestamp
}

interface SafetyAnalysis {
  overallRisk: 'safe' | 'caution' | 'danger' | 'critical';
  maxDuration: number;
  verdict: string;
  reasons: string[];
  recommendations: string[];
  color: string;
  bgColor: string;
}

interface ZonePolygon {
  id: string;
  name: string;
  nameM: string;
  color: string;
  wards: string;
  center: [number, number];
  coords: [number, number][];
}

interface AssignedWorker {
  id: string;
  name: string;
  zone: string;
  manholeId: string;
  manholeLabel: string;
  lat: number;
  lng: number;
}

// ─── Weather helpers ──────────────────────────────────────────────────────────

function getWeatherDesc(code: number): string {
  if (code === 0)  return 'Clear sky';
  if (code <= 3)   return 'Partly cloudy';
  if (code <= 9)   return 'Foggy / Haze';
  if (code <= 29)  return 'Drizzle';
  if (code <= 49)  return 'Freezing drizzle';
  if (code <= 69)  return 'Rain';
  if (code <= 79)  return 'Snow showers';
  if (code <= 84)  return 'Rain showers';
  if (code <= 94)  return 'Thunderstorm';
  return 'Heavy thunderstorm';
}

function getWeatherIcon(code: number): string {
  if (code === 0)  return 'weather-sunny';
  if (code <= 3)   return 'weather-partly-cloudy';
  if (code <= 9)   return 'weather-fog';
  if (code <= 49)  return 'weather-rainy';
  if (code <= 69)  return 'weather-pouring';
  if (code <= 79)  return 'weather-snowy';
  if (code <= 84)  return 'weather-pouring';
  return 'weather-lightning-rainy';
}

function analyseWeatherSafety(w: WeatherData): SafetyAnalysis {
  const reasons: string[] = [];
  const recommendations: string[] = [];
  let riskScore = 0;
  let maxDuration = 90;

  // Rain risk
  if (w.rain >= 50) {
    riskScore += 5; maxDuration = 0;
    reasons.push(`Extreme rainfall (${w.rain.toFixed(1)} mm/hr) — severe flood risk in sewer lines`);
    recommendations.push('Do NOT enter sewer under any circumstances');
  } else if (w.rain >= 20) {
    riskScore += 4; maxDuration = 0;
    reasons.push(`Heavy rain (${w.rain.toFixed(1)} mm/hr) — sewer flooding likely`);
    recommendations.push('Entry strictly prohibited — wait for rain to stop');
  } else if (w.rain >= 7) {
    riskScore += 3; maxDuration = Math.min(maxDuration, 15);
    reasons.push(`Moderate rain (${w.rain.toFixed(1)} mm/hr) — water surge risk inside`);
    recommendations.push('Emergency entry only — maximum 15 minutes with standby team');
  } else if (w.rain >= 2) {
    riskScore += 2; maxDuration = Math.min(maxDuration, 30);
    reasons.push(`Light rain (${w.rain.toFixed(1)} mm/hr) — monitor water levels`);
    recommendations.push('Limit entry to 30 minutes, keep exit clear');
  } else if (w.rain > 0) {
    riskScore += 1; maxDuration = Math.min(maxDuration, 60);
    reasons.push('Trace rainfall — minor moisture increase inside sewer');
  }

  // Thunderstorm risk
  if (w.weathercode >= 80) {
    riskScore += 3; maxDuration = 0;
    reasons.push('Thunderstorm detected — lightning and flash flood risk');
    recommendations.push('All sewer work suspended until storm clears');
  }

  // Heat risk
  if (w.temp >= 42) {
    riskScore += 3; maxDuration = Math.min(maxDuration, 15);
    reasons.push(`Extreme heat (${w.temp}°C) — heat stroke risk in confined space`);
    recommendations.push('Maximum 15 min inside, mandatory 30 min rest outside');
  } else if (w.temp >= 38) {
    riskScore += 2; maxDuration = Math.min(maxDuration, 30);
    reasons.push(`High temperature (${w.temp}°C) — elevated heat stress in sewer`);
    recommendations.push('Carry water, limit to 30 min per entry');
  } else if (w.temp >= 35) {
    riskScore += 1; maxDuration = Math.min(maxDuration, 45);
    reasons.push(`Warm conditions (${w.temp}°C) — sewer interior will be hotter`);
    recommendations.push('Hydrate before entry, limit to 45 min');
  }

  // Humidity risk
  if (w.humidity >= 95) {
    riskScore += 2; maxDuration = Math.min(maxDuration, 20);
    reasons.push(`Very high humidity (${w.humidity}%) — worsens gas accumulation`);
    recommendations.push('Full respiratory protection required');
  } else if (w.humidity >= 85) {
    riskScore += 1; maxDuration = Math.min(maxDuration, 40);
    reasons.push(`High humidity (${w.humidity}%) — increased gas concentration risk`);
    recommendations.push('Enhanced ventilation before entry');
  }

  // Wind risk
  if (w.windspeed < 5 && w.rain === 0) {
    riskScore += 1;
    reasons.push(`Low wind speed (${w.windspeed} km/h) — gases may not disperse from manhole`);
    recommendations.push('Ventilate manhole for 5 min before entry');
  }

  let overallRisk: SafetyAnalysis['overallRisk'];
  let verdict: string;
  let color: string;
  let bgColor: string;

  if (riskScore === 0) {
    overallRisk = 'safe'; verdict = 'Safe to work';
    color = '#27AE60'; bgColor = '#E8F8F0';
    reasons.push('Weather conditions are favourable for sewer work');
    recommendations.push('Standard pre-monitoring required before entry');
    recommendations.push('Maintain regular sensor checks every 15 minutes');
  } else if (riskScore <= 2) {
    overallRisk = 'caution'; verdict = 'Proceed with caution';
    color = '#E67E22'; bgColor = '#FEF9E7';
  } else if (riskScore <= 5) {
    overallRisk = 'danger'; verdict = 'High risk — entry not recommended';
    color = '#C0392B'; bgColor = '#FDEDEC';
    if (maxDuration > 0) maxDuration = Math.min(maxDuration, 20);
  } else {
    overallRisk = 'critical'; verdict = 'CRITICAL — No entry permitted';
    color = '#7B241C'; bgColor = '#F9EBEA';
    maxDuration = 0;
    recommendations.push('Contact SMC supervisor before any action');
  }

  if (recommendations.length === 0) {
    recommendations.push('Always complete pre-monitoring scan before entry');
    recommendations.push('Keep SurakshaNet sensors active at all times');
  }

  return { overallRisk, maxDuration, verdict, reasons, recommendations, color, bgColor };
}

// ─── Real-time weather fetch with timeout & retry ─────────────────────────────

async function fetchWeatherFromAPI(): Promise<WeatherData> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000); // 8 s timeout

  try {
    const res = await fetch(WEATHER_API_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const json = await res.json();

    // Validate response shape
    if (!json?.current) {
      throw new Error('Unexpected API response shape');
    }

    const c = json.current;

    const weather: WeatherData = {
      temp:        Math.round((c.temperature_2m ?? 0) * 10) / 10,
      humidity:    Math.round(c.relative_humidity_2m ?? 0),
      rain:        Math.round((c.precipitation ?? 0) * 10) / 10,
      windspeed:   Math.round((c.windspeed_10m ?? 0) * 10) / 10,
      weathercode: c.weathercode ?? 0,
      description: getWeatherDesc(c.weathercode ?? 0),
      fetchedAt:   new Date().toISOString(),
    };

    return weather;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out — check internet connection');
    }
    throw err;
  }
}

// ─── Zone polygon coordinates ─────────────────────────────────────────────────

function getZonePolygons(): ZonePolygon[] {
  return [
    {
      id: 'north', name: 'North Zone', nameM: 'उत्तर विभाग',
      color: '#3B82F6', wards: 'North coverage area',
      center: [17.7145, 75.9110],
      coords: [
        [17.7275, 75.9015],[17.7275, 75.9215],[17.7165, 75.9240],
        [17.7075, 75.9180],[17.7075, 75.9050],[17.7155, 75.8995],
      ],
    },
    {
      id: 'west', name: 'West Zone', nameM: 'पश्चिम विभाग',
      color: '#A855F7', wards: 'West coverage area',
      center: [17.7005, 75.8905],
      coords: [
        [17.7145, 75.8785],[17.7145, 75.9025],[17.7045, 75.9075],
        [17.6940, 75.9040],[17.6860, 75.8930],[17.6895, 75.8815],[17.6995, 75.8770],
      ],
    },
    {
      id: 'central', name: 'Central Zone', nameM: 'मध्य विभाग',
      color: '#EF4444', wards: 'Central coverage area',
      center: [17.6895, 75.9075],
      coords: [
        [17.7030, 75.9025],[17.7025, 75.9145],[17.6950, 75.9200],
        [17.6865, 75.9180],[17.6815, 75.9105],[17.6830, 75.9015],[17.6910, 75.8985],
      ],
    },
    {
      id: 'east', name: 'East Zone', nameM: 'पूर्व विभाग',
      color: '#F59E0B', wards: 'East coverage area',
      center: [17.6925, 75.9235],
      coords: [
        [17.7085, 75.9155],[17.7085, 75.9395],[17.6955, 75.9435],
        [17.6835, 75.9380],[17.6815, 75.9200],[17.6890, 75.9130],
      ],
    },
    {
      id: 'south', name: 'South Zone', nameM: 'दक्षिण विभाग',
      color: '#22C55E', wards: 'South coverage area',
      center: [17.6715, 75.9065],
      coords: [
        [17.6845, 75.8945],[17.6880, 75.9235],[17.6750, 75.9315],
        [17.6615, 75.9255],[17.6575, 75.9055],[17.6650, 75.8925],
      ],
    },
  ];
}

// ─── Leaflet HTML builder — weather data passed in and shown on map ───────────

function buildLeafletHTML(
  selectedZone: string | null,
  selectedWorker: AssignedWorker | null,
  weather: WeatherData | null,
): string {
  const allManholes = SOLAPUR_MANHOLES.map((m) => ({
    id: m.id, lat: m.lat, lng: m.lng, zone: m.zone, label: m.label,
  }));

  const zonePolygons = getZonePolygons();

  // Build weather overlay HTML for the map
  const weatherOverlayHtml = weather
    ? `
      <div id="wx-overlay">
        <span id="wx-icon">${getWeatherIconEmoji(weather.weathercode)}</span>
        <span id="wx-temp">${weather.temp}°C</span>
        <span id="wx-desc">${weather.description}</span>
        <span id="wx-rain">${weather.rain > 0 ? `🌧 ${weather.rain}mm/hr` : ''}</span>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:100%; height:100%; font-family:system-ui,-apple-system,sans-serif; }
  #map { width:100%; height:360px; }
  .legend {
    display:flex; flex-wrap:wrap; gap:8px;
    justify-content:center; align-items:center;
    padding:10px 12px; background:#fff; border-top:1px solid #E5E7EB;
  }
  .leg {
    display:flex; align-items:center; gap:6px;
    padding:6px 11px; border-radius:999px; border:1px solid #E2E8F0;
    background:#fff; color:#475569; font-size:12px; font-weight:500;
    cursor:pointer; transition:all .2s;
  }
  .leg.active { font-weight:700; box-shadow:0 3px 10px rgba(15,23,42,.08); }
  .leg-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
  .zone-label {
    background:rgba(255,255,255,.94); color:#0F172A;
    border:1px solid rgba(148,163,184,.28); border-radius:12px;
    padding:5px 9px; font-size:10px; font-weight:700;
    line-height:1.2; text-align:center; white-space:nowrap;
    box-shadow:0 2px 10px rgba(0,0,0,.08);
  }
  .zone-label span { display:block; font-size:8px; font-weight:500; color:#64748B; margin-top:2px; }
  .leaflet-container { background:#EAF2FB; }
  .leaflet-control-zoom {
    border:none !important;
    box-shadow:0 8px 20px rgba(15,23,42,.12) !important;
    overflow:hidden; border-radius:16px !important;
  }
  .leaflet-control-zoom a {
    width:36px !important; height:36px !important;
    line-height:36px !important; color:#0F172A !important; font-weight:700;
  }
  .leaflet-popup-content-wrapper {
    border-radius:14px !important;
    box-shadow:0 10px 24px rgba(15,23,42,.16) !important;
  }
  .leaflet-popup-content { margin:12px 14px !important; font-size:12px; line-height:1.55; color:#334155; }
  .pop-title { font-size:13px; font-weight:700; color:#0F172A; margin-bottom:4px; }

  /* Real-time weather overlay on map */
  #wx-overlay {
    position:absolute; top:10px; right:10px; z-index:1000;
    background:rgba(255,255,255,0.92); backdrop-filter:blur(6px);
    border:1px solid rgba(148,163,184,0.3); border-radius:14px;
    padding:8px 12px; display:flex; align-items:center; gap:6px;
    font-size:12px; font-weight:600; color:#0F172A;
    box-shadow:0 4px 14px rgba(0,0,0,0.10);
  }
  #wx-icon { font-size:18px; }
  #wx-temp { font-size:14px; font-weight:700; }
  #wx-desc { color:#64748B; font-weight:400; font-size:11px; }
  #wx-rain { color:#2980B9; font-size:11px; }

  @keyframes workerPulse {
    0%   { box-shadow: 0 0 0 0   rgba(239,68,68,0.5), 0 6px 14px rgba(0,0,0,0.22); }
    70%  { box-shadow: 0 0 0 14px rgba(239,68,68,0),   0 6px 14px rgba(0,0,0,0.22); }
    100% { box-shadow: 0 0 0 0   rgba(239,68,68,0),   0 6px 14px rgba(0,0,0,0.22); }
  }
  .worker-dot {
    width:20px; height:20px; border-radius:50%;
    background:#EF4444; border:3px solid #fff;
    animation: workerPulse 1.6s infinite;
  }
  .manhole-dot {
    border-radius:50%; border:1.5px solid #fff;
    box-shadow:0 2px 5px rgba(0,0,0,.18); transition: transform .2s;
  }
  .manhole-dot:hover { transform: scale(1.4); }
</style>
</head>
<body>
<div style="position:relative;">
  <div id="map"></div>
  ${weatherOverlayHtml}
</div>
<div class="legend" id="legend"></div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<script>
  var SEL             = ${JSON.stringify(selectedZone)};
  var ZONES           = ${JSON.stringify(zonePolygons)};
  var MANHOLES        = ${JSON.stringify(allManholes)};
  var SELECTED_WORKER = ${JSON.stringify(selectedWorker)};

  function msg(data) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(data));
    else window.parent.postMessage(JSON.stringify(data), '*');
  }

  var map = L.map('map', { zoomControl:true, attributionControl:false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19 }).addTo(map);
  L.control.attribution({ prefix:'OpenStreetMap' }).addTo(map);

  var allBounds = [];
  ZONES.forEach(function(z){ z.coords.forEach(function(c){ allBounds.push(c); }); });
  if (allBounds.length) map.fitBounds(allBounds, { padding:[8,8] });
  else map.setView([17.6869,75.9064], 13);

  ZONES.forEach(function(z) {
    var isSel  = SEL === z.id;
    var anySel = SEL !== null;
    var fillOp = !anySel ? 0.18 : (isSel ? 0.28 : 0.05);
    var poly = L.polygon(z.coords, {
      color:z.color, weight: isSel ? 3 : 1.8,
      opacity: isSel ? 1 : 0.85,
      fillColor:z.color, fillOpacity:fillOp, smoothFactor:1.2
    }).addTo(map);
    poly.bindPopup('<div class="pop-title">'+z.name+'</div><div>'+z.nameM+'</div>');
    poly.on('click', function(){ msg({type:'zone', id:z.id}); });
    L.marker(z.center, {
      icon: L.divIcon({
        html:'<div class="zone-label">'+z.name+'<span>'+z.nameM+'</span></div>',
        className:'', iconSize:[90,34], iconAnchor:[45,17]
      }),
      interactive:false, keyboard:false
    }).addTo(map);
  });

  MANHOLES.forEach(function(m) {
    var zone     = ZONES.find(function(z){ return z.id === m.zone; });
    var isActive = SEL === null || SEL === m.zone;
    var color    = zone ? zone.color : '#1D4ED8';
    var size     = isActive ? 9 : 7;
    var icon = L.divIcon({
      html: '<div class="manhole-dot" style="width:'+size+'px;height:'+size+'px;background:'+color+';opacity:'+(isActive?'0.95':'0.15')+'"></div>',
      className:'', iconSize:[size,size], iconAnchor:[size/2,size/2]
    });
    var marker = L.marker([m.lat, m.lng], { icon:icon }).addTo(map);
    if (isActive) {
      marker.bindPopup(
        '<div class="pop-title">'+m.id+'</div>'+
        '<div>'+m.label+'</div>'+
        '<div style="margin-top:4px;color:#64748B;">'+(zone ? zone.name : m.zone)+'</div>'
      );
      marker.on('click', function(){ msg({type:'manhole', id:m.id, zone:m.zone, label:m.label}); });
    }
  });

  if (SELECTED_WORKER && SELECTED_WORKER.lat && SELECTED_WORKER.lng) {
    var zone = ZONES.find(function(z){ return z.name === SELECTED_WORKER.zone; });
    var zColor = zone ? zone.color : '#EF4444';
    L.circle([SELECTED_WORKER.lat, SELECTED_WORKER.lng], {
      radius:80, color:zColor, weight:2, opacity:0.6,
      fillColor:zColor, fillOpacity:0.12
    }).addTo(map);
    var workerIcon = L.divIcon({
      html: '<div class="worker-dot" style="background:'+zColor+';border-color:#fff;border-width:3px"></div>',
      className:'', iconSize:[20,20], iconAnchor:[10,10]
    });
    L.marker([SELECTED_WORKER.lat, SELECTED_WORKER.lng], { icon:workerIcon, zIndexOffset:1000 })
      .addTo(map)
      .bindPopup(
        '<div class="pop-title">👷 '+SELECTED_WORKER.name+'</div>'+
        '<div><b>Manhole:</b> '+SELECTED_WORKER.manholeId+'</div>'+
        '<div><b>Location:</b> '+SELECTED_WORKER.manholeLabel+'</div>'+
        '<div style="margin-top:4px;color:#64748B;"><b>Zone:</b> '+SELECTED_WORKER.zone+'</div>'
      ).openPopup();
    map.flyTo([SELECTED_WORKER.lat, SELECTED_WORKER.lng], 17, { animate:true, duration:1.2 });
  }

  var legend = document.getElementById('legend');
  var allBtn = document.createElement('div');
  allBtn.className = 'leg' + (SEL===null ? ' active' : '');
  allBtn.innerHTML = '<div class="leg-dot" style="background:#64748B"></div>All Zones';
  allBtn.onclick = function(){ msg({type:'zone', id:null}); };
  legend.appendChild(allBtn);

  ZONES.forEach(function(z) {
    var isSel = SEL === z.id;
    var div = document.createElement('div');
    div.className = 'leg' + (isSel ? ' active' : '');
    div.style.borderColor = isSel ? z.color : '#E2E8F0';
    div.style.color       = isSel ? z.color : '#475569';
    div.innerHTML = '<div class="leg-dot" style="background:'+z.color+'"></div>'+z.name;
    div.onclick = function(){ msg({type:'zone', id:z.id}); };
    legend.appendChild(div);
  });
<\/script>
</body>
</html>`;
}

// Helper: WMO weather code → emoji (used in map overlay)
function getWeatherIconEmoji(code: number): string {
  if (code === 0)  return '☀️';
  if (code <= 3)   return '⛅';
  if (code <= 9)   return '🌫️';
  if (code <= 49)  return '🌦️';
  if (code <= 69)  return '🌧️';
  if (code <= 79)  return '❄️';
  if (code <= 84)  return '🌧️';
  return '⛈️';
}

// ─── Map component ────────────────────────────────────────────────────────────

function SolapurMap({
  selectedZone,
  selectedWorker,
  weather,
  onSelectZone,
}: {
  selectedZone: string | null;
  selectedWorker: AssignedWorker | null;
  weather: WeatherData | null;
  onSelectZone: (id: string | null) => void;
}) {
  const html = buildLeafletHTML(selectedZone, selectedWorker, weather);

  const onMsg = useCallback(
    (data: string) => {
      try {
        const m = JSON.parse(data);
        if (m.type === 'zone') {
          onSelectZone(m.id === null ? null : m.id === selectedZone ? null : m.id);
        }
      } catch {}
    },
    [selectedZone, onSelectZone]
  );

  if (Platform.OS === 'web') return <WebLeafletMap html={html} onMessage={onMsg} />;
  return <NativeLeafletMap html={html} onMessage={onMsg} />;
}

function WebLeafletMap({ html, onMessage }: { html: string; onMessage: (d: string) => void }) {
  useEffect(() => {
    const handler = (e: any) => { try { onMessage(e.data); } catch {} };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onMessage]);

  if (typeof document === 'undefined') return null;
  return (
    <iframe
      srcDoc={html}
      style={{ width:'100%', height:420, border:'none', borderRadius:12 } as any}
    />
  );
}

function NativeLeafletMap({ html, onMessage }: { html: string; onMessage: (d: string) => void }) {
  let WebView: any = null;
  try { WebView = require('react-native-webview').WebView; } catch {}

  if (!WebView) {
    return (
      <View style={mapSt.fallback}>
        <MaterialCommunityIcons name="map" size={36} color={Colors.primary} style={{ opacity:0.4 }} />
        <Text style={mapSt.fallbackTitle}>Interactive Map</Text>
        <Text style={mapSt.fallbackSub}>Run: npx expo install react-native-webview</Text>
        <View style={mapSt.legend}>
          {SOLAPUR_ZONES.map((z) => (
            <View key={z.id} style={mapSt.legendItem}>
              <View style={[mapSt.legendDot, { backgroundColor: z.color }]} />
              <Text style={mapSt.legendText}>{z.name}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <WebView
      source={{ html }}
      style={mapSt.webview}
      scrollEnabled={false}
      javaScriptEnabled
      onMessage={(e: any) => onMessage(e.nativeEvent.data)}
    />
  );
}

const mapSt = StyleSheet.create({
  webview: { height: 420 },
  fallback: {
    backgroundColor: Colors.white, padding:24, alignItems:'center',
    gap:8, minHeight:200, justifyContent:'center',
  },
  fallbackTitle: { fontSize:15, fontFamily:'Poppins_600SemiBold', color:Colors.primary },
  fallbackSub:   { fontSize:12, fontFamily:'Poppins_400Regular', color:Colors.textSecondary, textAlign:'center' },
  legend:        { flexDirection:'row', flexWrap:'wrap', justifyContent:'center', gap:8, marginTop:8 },
  legendItem:    { flexDirection:'row', alignItems:'center', gap:4 },
  legendDot:     { width:10, height:10, borderRadius:5 },
  legendText:    { fontSize:11, fontFamily:'Poppins_400Regular', color:Colors.textSecondary },
});

// ─── Weather panel — receives real data from parent ───────────────────────────

interface WeatherPanelProps {
  weather: WeatherData | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function WeatherAnalysisPanel({ weather, loading, error, onRefresh }: WeatherPanelProps) {
  const analysis = weather ? analyseWeatherSafety(weather) : null;

  const riskIcon = (r: string) =>
    r === 'safe' ? 'shield-check' :
    r === 'caution' ? 'alert' :
    r === 'danger' ? 'alert-circle' : 'close-octagon';

  const formattedTime = weather
    ? new Date(weather.fetchedAt).toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', hour12: true,
      })
    : '';

  return (
    <View style={wx.card}>
      <View style={wx.header}>
        <View style={wx.headerLeft}>
          <MaterialCommunityIcons
            name={weather ? (getWeatherIcon(weather.weathercode) as any) : 'weather-partly-cloudy'}
            size={20}
            color={Colors.primary}
          />
          <Text style={wx.title}>Weather + AI Safety Analysis</Text>
        </View>
        <TouchableOpacity onPress={onRefresh} style={wx.refreshBtn} disabled={loading}>
          {loading
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : <MaterialCommunityIcons name="refresh" size={18} color={Colors.primary} />}
        </TouchableOpacity>
      </View>

      <Text style={wx.sub}>Solapur, Maharashtra · Live via Open-Meteo</Text>

      {/* Loading state */}
      {loading && !weather && (
        <View style={wx.loadingRow}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={wx.loadingText}>Fetching live weather data...</Text>
        </View>
      )}

      {/* Error state */}
      {error && !loading && !weather && (
        <View style={wx.errorBox}>
          <MaterialCommunityIcons name="wifi-off" size={20} color={Colors.danger} />
          <View style={{ flex:1 }}>
            <Text style={wx.errorTitle}>Could not fetch weather data</Text>
            <Text style={wx.errorDetail}>{error}</Text>
          </View>
          <TouchableOpacity onPress={onRefresh} style={wx.retryBtn}>
            <Text style={wx.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Stale error (has cached data but latest fetch failed) */}
      {error && weather && !loading && (
        <View style={wx.staleRow}>
          <MaterialCommunityIcons name="alert-outline" size={13} color="#E67E22" />
          <Text style={wx.staleText}>Showing cached data · {error}</Text>
          <TouchableOpacity onPress={onRefresh}>
            <Text style={wx.retrySmall}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Weather data */}
      {weather && (
        <>
          <View style={wx.metricsRow}>
            {[
              { icon:'thermometer',    color:'#E67E22', val:`${weather.temp}°C`,        label:'Temp' },
              { icon:'water-percent',  color:'#3498DB', val:`${weather.humidity}%`,     label:'Humidity' },
              { icon:'weather-rainy',  color:'#2980B9', val:`${weather.rain} mm`,       label:'Rain/hr' },
              { icon:'weather-windy',  color:'#7F8C8D', val:`${weather.windspeed} km/h`, label:'Wind' },
            ].map((m) => (
              <View key={m.label} style={wx.metric}>
                <MaterialCommunityIcons name={m.icon as any} size={18} color={m.color} />
                <Text style={wx.metricVal}>{m.val}</Text>
                <Text style={wx.metricLabel}>{m.label}</Text>
              </View>
            ))}
          </View>

          <View style={wx.conditionRow}>
            <MaterialCommunityIcons name={getWeatherIcon(weather.weathercode) as any} size={13} color={Colors.textSecondary} />
            <Text style={wx.conditionText}>{weather.description}</Text>
            {formattedTime ? (
              <Text style={wx.updatedText}>✓ Live · {formattedTime}</Text>
            ) : null}
          </View>

          <View style={wx.divider} />

          {analysis && (
            <>
              <View style={[wx.verdictBanner, { backgroundColor:analysis.bgColor, borderColor:analysis.color }]}>
                <MaterialCommunityIcons name={riskIcon(analysis.overallRisk) as any} size={26} color={analysis.color} />
                <View style={{ flex:1 }}>
                  <Text style={[wx.verdictTitle, { color:analysis.color }]}>{analysis.verdict}</Text>
                  <Text style={[wx.verdictDuration, { color:analysis.color }]}>
                    {analysis.maxDuration > 0
                      ? `Max safe duration inside: ${analysis.maxDuration} minutes`
                      : 'Entry not permitted right now'}
                  </Text>
                </View>
              </View>

              <Text style={wx.sectionLabel}>WHY</Text>
              {analysis.reasons.map((r, i) => (
                <View key={i} style={wx.reasonRow}>
                  <View style={[wx.reasonDot, { backgroundColor:analysis.color }]} />
                  <Text style={wx.reasonText}>{r}</Text>
                </View>
              ))}

              <Text style={[wx.sectionLabel, { marginTop:10 }]}>RECOMMENDATIONS</Text>
              {analysis.recommendations.map((r, i) => (
                <View key={i} style={wx.recRow}>
                  <MaterialCommunityIcons name="checkbox-marked-circle-outline" size={14} color={Colors.success} />
                  <Text style={wx.recText}>{r}</Text>
                </View>
              ))}

              <View style={wx.noteRow}>
                <MaterialCommunityIcons name="information-outline" size={12} color={Colors.textMuted} />
                <Text style={wx.noteText}>
                  Analysis based on real-time weather data from Open-Meteo. Always complete sensor pre-monitoring before entry.
                </Text>
              </View>
            </>
          )}
        </>
      )}
    </View>
  );
}

const wx = StyleSheet.create({
  card:           { backgroundColor:Colors.white, borderRadius:BorderRadius.md, padding:Spacing.md, ...Shadows.sm },
  header:         { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:2 },
  headerLeft:     { flexDirection:'row', alignItems:'center', gap:8 },
  title:          { fontSize:14, fontFamily:'Poppins_600SemiBold', color:Colors.textPrimary },
  sub:            { fontSize:11, fontFamily:'Poppins_400Regular', color:Colors.textSecondary, marginBottom:12 },
  refreshBtn:     { padding:6, minWidth:30, alignItems:'center' },

  // Loading
  loadingRow:     { flexDirection:'row', alignItems:'center', gap:8, paddingVertical:16 },
  loadingText:    { fontSize:13, fontFamily:'Poppins_400Regular', color:Colors.textSecondary },

  // Error states
  errorBox:       { flexDirection:'row', alignItems:'center', gap:10, padding:12, backgroundColor:'#FEF2F2', borderRadius:10, borderWidth:1, borderColor:'#FECACA', marginBottom:8 },
  errorTitle:     { fontSize:13, fontFamily:'Poppins_600SemiBold', color:Colors.danger },
  errorDetail:    { fontSize:11, fontFamily:'Poppins_400Regular', color:Colors.danger, marginTop:2 },
  retryBtn:       { backgroundColor:Colors.danger, paddingHorizontal:10, paddingVertical:6, borderRadius:8 },
  retryText:      { fontSize:12, fontFamily:'Poppins_600SemiBold', color:'#fff' },

  staleRow:       { flexDirection:'row', alignItems:'center', gap:5, padding:8, backgroundColor:'#FFFBEB', borderRadius:8, marginBottom:8, borderWidth:1, borderColor:'#FDE68A' },
  staleText:      { fontSize:11, fontFamily:'Poppins_400Regular', color:'#92400E', flex:1 },
  retrySmall:     { fontSize:11, fontFamily:'Poppins_600SemiBold', color:Colors.primary },

  // Metrics
  metricsRow:     { flexDirection:'row', justifyContent:'space-between', marginBottom:10 },
  metric:         { alignItems:'center', gap:3, flex:1 },
  metricVal:      { fontSize:15, fontFamily:'Poppins_700Bold', color:Colors.textPrimary },
  metricLabel:    { fontSize:10, fontFamily:'Poppins_400Regular', color:Colors.textSecondary },

  conditionRow:   { flexDirection:'row', alignItems:'center', gap:5, marginBottom:12 },
  conditionText:  { fontSize:12, fontFamily:'Poppins_400Regular', color:Colors.textSecondary, flex:1 },
  updatedText:    { fontSize:10, fontFamily:'Poppins_600SemiBold', color:Colors.success },

  divider:        { height:1, backgroundColor:Colors.border, marginBottom:12 },

  verdictBanner:  { flexDirection:'row', alignItems:'center', gap:12, borderRadius:8, padding:12, borderWidth:1.5, marginBottom:14 },
  verdictTitle:   { fontSize:14, fontFamily:'Poppins_700Bold' },
  verdictDuration:{ fontSize:12, fontFamily:'Poppins_500Medium', marginTop:2 },

  sectionLabel:   { fontSize:10, fontFamily:'Poppins_700Bold', color:Colors.textMuted, letterSpacing:0.8, marginBottom:6 },
  reasonRow:      { flexDirection:'row', alignItems:'flex-start', gap:8, marginBottom:5 },
  reasonDot:      { width:6, height:6, borderRadius:3, marginTop:5, flexShrink:0 },
  reasonText:     { fontSize:12, fontFamily:'Poppins_400Regular', color:Colors.textPrimary, flex:1, lineHeight:18 },
  recRow:         { flexDirection:'row', alignItems:'flex-start', gap:6, marginBottom:5 },
  recText:        { fontSize:12, fontFamily:'Poppins_400Regular', color:Colors.textPrimary, flex:1, lineHeight:18 },
  noteRow:        { flexDirection:'row', alignItems:'flex-start', gap:5, marginTop:10, padding:8, backgroundColor:Colors.infoBg, borderRadius:6 },
  noteText:       { fontSize:10, fontFamily:'Poppins_400Regular', color:Colors.textSecondary, flex:1, lineHeight:15 },
});

// ─── Worker locate banner ─────────────────────────────────────────────────────

function WorkerLocateBanner({
  worker,
  onDismiss,
}: {
  worker: AssignedWorker;
  onDismiss: () => void;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(fadeAnim, { toValue:1, useNativeDriver:true, tension:60, friction:8 }).start();
  }, [worker.id]);

  return (
    <Animated.View style={[styles.locateBanner, { opacity:fadeAnim, transform:[{ scale:fadeAnim }] }]}>
      <View style={styles.locateBannerLeft}>
        <MaterialCommunityIcons name="crosshairs-gps" size={18} color="#EF4444" />
        <View>
          <Text style={styles.locateBannerName}>📍 {worker.name}</Text>
          <Text style={styles.locateBannerSub}>{worker.manholeLabel} · {worker.manholeId}</Text>
        </View>
      </View>
      <TouchableOpacity onPress={onDismiss} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
        <MaterialCommunityIcons name="close-circle" size={20} color="#94a3b8" />
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ZonesScreen() {
  const { language, workers, sensors, alerts } = useStore();
  const T = getText(language);

  const [selectedZone,   setSelectedZone]   = useState<string | null>(null);
  const [selectedWorker, setSelectedWorker] = useState<AssignedWorker | null>(null);
  const [expandedZones,  setExpandedZones]  = useState<Set<string>>(new Set());

  // ── Lifted weather state (shared between panel + map) ──
  const [weather,        setWeather]        = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError,   setWeatherError]   = useState<string | null>(null);

  const loadWeather = useCallback(async () => {
    setWeatherLoading(true);
    setWeatherError(null);
    try {
      const data = await fetchWeatherFromAPI();
      setWeather(data);
    } catch (err: any) {
      setWeatherError(err?.message ?? 'Unknown error fetching weather');
    } finally {
      setWeatherLoading(false);
    }
  }, []);

  // Fetch on mount, then refresh every 10 minutes automatically
  useEffect(() => {
    loadWeather();
    const interval = setInterval(loadWeather, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadWeather]);

  // ── Manhole assignment helpers ──
  const zoneManholes = useMemo(() => {
    const map: Record<string, typeof SOLAPUR_MANHOLES> = {};
    ['north','south','east','west','central'].forEach((id) => {
      map[id] = SOLAPUR_MANHOLES.filter((m) => m.zone === id);
    });
    return map;
  }, []);

  const getWorkerManhole = (worker: any) => {
    const inZone = zoneManholes[worker.zone] ?? [];
    const source = inZone.length > 0 ? inZone : SOLAPUR_MANHOLES;
    const key    = String(worker.id ?? worker.name ?? 'worker');
    const hash   = key.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
    return source[hash % source.length];
  };

  const handleLocateWorker = (worker: any, zone: typeof SOLAPUR_ZONES[number]) => {
    const mh = getWorkerManhole(worker);
    const assigned: AssignedWorker = {
      id:           worker.id,
      name:         worker.name,
      zone:         zone.name,
      manholeId:    mh.id,
      manholeLabel: mh.label,
      lat:          mh.lat,
      lng:          mh.lng,
    };
    setSelectedWorker(assigned);
    setSelectedZone(zone.id);
    setExpandedZones((prev) => new Set([...prev, zone.id]));
  };

  const toggleZoneExpand = (zoneId: string) => {
    setExpandedZones((prev) => {
      const next = new Set(prev);
      if (next.has(zoneId)) next.delete(zoneId);
      else next.add(zoneId);
      return next;
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{T.dashboard.zones}</Text>
        <Text style={styles.headerSub}>Solapur City — 5 Zones</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom:80 }}>

        {selectedWorker && (
          <View style={{ paddingHorizontal:Spacing.md, paddingTop:Spacing.sm }}>
            <WorkerLocateBanner
              worker={selectedWorker}
              onDismiss={() => setSelectedWorker(null)}
            />
          </View>
        )}

        {/* Map — receives live weather for overlay */}
        <View style={styles.mapCard}>
          <SolapurMap
            selectedZone={selectedZone}
            selectedWorker={selectedWorker}
            weather={weather}
            onSelectZone={(zoneId) => {
              setSelectedZone(zoneId);
              if (!zoneId) {
                setSelectedWorker(null);
              } else if (selectedWorker && selectedWorker.zone !== zoneId) {
                setSelectedWorker(null);
              }
              if (zoneId) toggleZoneExpand(zoneId);
            }}
          />
        </View>

        {/* Weather panel — driven by lifted state */}
        <View style={styles.section}>
          <WeatherAnalysisPanel
            weather={weather}
            loading={weatherLoading}
            error={weatherError}
            onRefresh={loadWeather}
          />
        </View>

        {/* Zone details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Zone Details</Text>

          {SOLAPUR_ZONES.map((zone) => {
            const zoneWorkers    = workers.filter((w) => w.zone === zone.id);
            const safeWorkers    = zoneWorkers.filter((w) => { const s=sensors[w.id]; return !s||getSafetyStatus(s)==='safe'; });
            const dangerWorkers  = zoneWorkers.filter((w) => { const s=sensors[w.id]; return s&&getSafetyStatus(s)==='danger'; });
            const warningWorkers = zoneWorkers.filter((w) => { const s=sensors[w.id]; return s&&getSafetyStatus(s)==='warning'; });
            const zoneAlerts     = alerts.filter((a) => a.zone===zone.id && !a.resolved);
            const isSelected     = selectedZone === zone.id;
            const isExpanded     = expandedZones.has(zone.id);

            return (
              <TouchableOpacity
                key={zone.id}
                style={[styles.zoneCard, isSelected && styles.zoneCardSelected, { borderLeftColor:zone.color }]}
                onPress={() => {
                  const next = isSelected ? null : zone.id;
                  setSelectedZone(next);
                  if (!next) setSelectedWorker(null);
                  else {
                    toggleZoneExpand(zone.id);
                    if (selectedWorker && selectedWorker.zone !== zone.name) setSelectedWorker(null);
                  }
                }}
                activeOpacity={0.85}
              >
                <View style={styles.zoneCardHeader}>
                  <View style={[styles.zoneIconBg, { backgroundColor:zone.color+'18' }]}>
                    <MaterialCommunityIcons name="map-marker-radius" size={22} color={zone.color} />
                  </View>
                  <View style={styles.zoneCardInfo}>
                    <Text style={styles.zoneName}>{zone.name}</Text>
                    <Text style={styles.zoneNameMr}>{zone.nameMarathi}</Text>
                  </View>
                  {zoneAlerts.length > 0 && (
                    <View style={[styles.alertBadge, { backgroundColor:Colors.danger }]}>
                      <Text style={styles.alertBadgeText}>
                        {zoneAlerts.length} alert{zoneAlerts.length>1?'s':''}
                      </Text>
                    </View>
                  )}
                  <MaterialCommunityIcons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={20} color={Colors.textMuted}
                  />
                </View>

                <View style={styles.statusRow}>
                  <View style={styles.statusItem}>
                    <MaterialCommunityIcons name="account-group" size={16} color={Colors.primary} />
                    <Text style={styles.statusItemText}>{zoneWorkers.length} total</Text>
                  </View>
                  <View style={styles.statusItem}>
                    <MaterialCommunityIcons name="shield-check" size={16} color={Colors.success} />
                    <Text style={[styles.statusItemText, { color:Colors.success }]}>{safeWorkers.length} safe</Text>
                  </View>
                  {warningWorkers.length > 0 && (
                    <View style={styles.statusItem}>
                      <MaterialCommunityIcons name="alert" size={16} color={Colors.warning} />
                      <Text style={[styles.statusItemText, { color:Colors.warning }]}>{warningWorkers.length} warn</Text>
                    </View>
                  )}
                  {dangerWorkers.length > 0 && (
                    <View style={styles.statusItem}>
                      <MaterialCommunityIcons name="alarm-light" size={16} color={Colors.danger} />
                      <Text style={[styles.statusItemText, { color:Colors.danger }]}>{dangerWorkers.length} danger</Text>
                    </View>
                  )}
                </View>

                {isExpanded && (
                  <View style={styles.wardsSection}>
                    <Text style={styles.wardsTitle}>Coverage Areas:</Text>
                    <View style={styles.wardsList}>
                      {zone.wards.map((ward) => (
                        <View key={ward} style={[styles.wardChip, { borderColor:zone.color }]}>
                          <Text style={[styles.wardChipText, { color:zone.color }]}>{ward}</Text>
                        </View>
                      ))}
                    </View>

                    {zoneWorkers.length > 0 && (
                      <>
                        <Text style={[styles.wardsTitle, { marginTop:Spacing.sm }]}>
                          Active Workers ({zoneWorkers.length}):
                        </Text>

                        {zoneWorkers.map((w) => {
                          const s          = sensors[w.id];
                          const st         = s ? getSafetyStatus(s) : 'safe';
                          const stColor    = st === 'safe' ? Colors.success : st === 'warning' ? Colors.warning : Colors.danger;
                          const assignedMH = getWorkerManhole(w);
                          const isWorkerSel = selectedWorker?.id === w.id;

                          return (
                            <TouchableOpacity
                              key={w.id}
                              style={[styles.workerRow, isWorkerSel && styles.workerRowSelected]}
                              activeOpacity={0.8}
                              onPress={() => handleLocateWorker(w, zone)}
                            >
                              <View style={[styles.workerAvatar, { backgroundColor:zone.color+'18' }]}>
                                <Text style={[styles.workerAvatarText, { color:zone.color }]}>
                                  {w.name.split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()}
                                </Text>
                              </View>
                              <View style={styles.workerMain}>
                                <Text style={[styles.workerRowName, isWorkerSel && { color:zone.color }]}>
                                  {w.name}
                                </Text>
                                <Text style={styles.workerRowSub}>
                                  📍 {assignedMH.id} · {assignedMH.label}
                                </Text>
                              </View>
                              <View style={{ alignItems:'flex-end', gap:4 }}>
                                <View style={[styles.workerStatusPill, { backgroundColor:stColor+'18', borderColor:stColor }]}>
                                  <View style={[styles.workerStatusDot, { backgroundColor:stColor }]} />
                                  <Text style={[styles.workerStatusText, { color:stColor }]}>{st}</Text>
                                </View>
                                <View style={[styles.locateBtn, isWorkerSel && { backgroundColor:zone.color+'18', borderColor:zone.color }]}>
                                  <MaterialCommunityIcons
                                    name="crosshairs-gps"
                                    size={11}
                                    color={isWorkerSel ? zone.color : Colors.textSecondary}
                                  />
                                  <Text style={[styles.locateBtnText, isWorkerSel && { color:zone.color }]}>
                                    {isWorkerSel ? 'Located' : 'Locate'}
                                  </Text>
                                </View>
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      </>
                    )}

                    {zoneWorkers.length === 0 && (
                      <View style={styles.emptyWorkers}>
                        <MaterialCommunityIcons name="account-off-outline" size={20} color={Colors.textMuted} />
                        <Text style={styles.emptyWorkersText}>No workers assigned to this zone yet.</Text>
                        <Text style={styles.emptyWorkersSub}>Add workers from the Workers tab.</Text>
                      </View>
                    )}

                    {selectedWorker && selectedWorker.zone === zone.name && (
                      <View style={[styles.selectedWorkerCard, { borderColor:zone.color+'40' }]}>
                        <View style={styles.selectedWorkerHeader}>
                          <MaterialCommunityIcons name="crosshairs-gps" size={14} color={zone.color} />
                          <Text style={[styles.selectedWorkerTitle, { color:zone.color }]}>
                            Showing on map ↑
                          </Text>
                        </View>
                        <Text style={styles.selectedWorkerText}>
                          <Text style={styles.selectedWorkerStrong}>{selectedWorker.name}</Text>
                          {' '}is working at{' '}
                          <Text style={styles.selectedWorkerStrong}>{selectedWorker.manholeLabel}</Text>
                        </Text>
                        <Text style={styles.selectedWorkerSub}>
                          Manhole ID: {selectedWorker.manholeId}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:     { flex:1, backgroundColor:Colors.background },
  header:        { backgroundColor:Colors.primary, paddingHorizontal:Spacing.md, paddingVertical:Spacing.md },
  headerTitle:   { color:Colors.white, fontSize:18, fontFamily:'Poppins_700Bold' },
  headerSub:     { color:'#B8C8D8', fontSize:12, fontFamily:'Poppins_400Regular' },

  mapCard:       { margin:Spacing.md, borderRadius:BorderRadius.lg, overflow:'hidden', ...Shadows.md },
  section:       { padding:Spacing.md, paddingTop:0, gap:Spacing.sm },
  sectionTitle:  { fontSize:16, fontFamily:'Poppins_600SemiBold', color:Colors.textPrimary, marginBottom:Spacing.xs },

  locateBanner:      { flexDirection:'row', alignItems:'center', justifyContent:'space-between', backgroundColor:'#FFF1F2', borderRadius:10, padding:10, borderWidth:1, borderColor:'#FECDD3', marginBottom:6 },
  locateBannerLeft:  { flexDirection:'row', alignItems:'center', gap:8, flex:1 },
  locateBannerName:  { fontSize:13, fontFamily:'Poppins_600SemiBold', color:'#1e293b' },
  locateBannerSub:   { fontSize:11, fontFamily:'Poppins_400Regular', color:'#64748b' },

  zoneCard:          { backgroundColor:Colors.white, borderRadius:BorderRadius.md, padding:Spacing.md, borderLeftWidth:4, ...Shadows.sm, marginBottom:Spacing.sm },
  zoneCardSelected:  { ...Shadows.md },
  zoneCardHeader:    { flexDirection:'row', alignItems:'center', gap:Spacing.sm, marginBottom:Spacing.sm },
  zoneIconBg:        { width:40, height:40, borderRadius:20, justifyContent:'center', alignItems:'center' },
  zoneCardInfo:      { flex:1 },
  zoneName:          { fontSize:15, fontFamily:'Poppins_600SemiBold', color:Colors.textPrimary },
  zoneNameMr:        { fontSize:11, fontFamily:'Poppins_400Regular', color:Colors.textSecondary },
  alertBadge:        { paddingHorizontal:8, paddingVertical:3, borderRadius:BorderRadius.full },
  alertBadgeText:    { color:Colors.white, fontSize:10, fontFamily:'Poppins_600SemiBold' },

  statusRow:         { flexDirection:'row', gap:Spacing.md, paddingTop:Spacing.xs, borderTopWidth:1, borderTopColor:Colors.border },
  statusItem:        { flexDirection:'row', alignItems:'center', gap:4 },
  statusItemText:    { fontSize:12, fontFamily:'Poppins_500Medium', color:Colors.textSecondary },

  wardsSection:      { marginTop:Spacing.md, paddingTop:Spacing.md, borderTopWidth:1, borderTopColor:Colors.border },
  wardsTitle:        { fontSize:12, fontFamily:'Poppins_600SemiBold', color:Colors.textSecondary, marginBottom:6 },
  wardsList:         { flexDirection:'row', flexWrap:'wrap', gap:6, marginBottom:6 },
  wardChip:          { borderWidth:1, borderRadius:BorderRadius.full, paddingHorizontal:10, paddingVertical:3 },
  wardChipText:      { fontSize:11, fontFamily:'Poppins_500Medium' },

  workerRow:         { flexDirection:'row', alignItems:'center', gap:10, paddingVertical:8, paddingHorizontal:8, borderRadius:10, marginBottom:4, borderWidth:1, borderColor:'transparent' },
  workerRowSelected: { backgroundColor:'#F8FAFC', borderColor:'#DCE7F7' },
  workerAvatar:      { width:34, height:34, borderRadius:17, justifyContent:'center', alignItems:'center', flexShrink:0 },
  workerAvatarText:  { fontSize:12, fontFamily:'Poppins_700Bold' },
  workerMain:        { flex:1 },
  workerRowName:     { fontSize:13, fontFamily:'Poppins_500Medium', color:Colors.textPrimary },
  workerRowSub:      { fontSize:11, fontFamily:'Poppins_400Regular', color:Colors.textSecondary, marginTop:1 },

  workerStatusPill:  { flexDirection:'row', alignItems:'center', gap:4, paddingHorizontal:7, paddingVertical:2, borderRadius:20, borderWidth:1 },
  workerStatusDot:   { width:6, height:6, borderRadius:3 },
  workerStatusText:  { fontSize:11, fontFamily:'Poppins_500Medium' },

  locateBtn:         { flexDirection:'row', alignItems:'center', gap:3, paddingHorizontal:7, paddingVertical:3, borderRadius:6, borderWidth:1, borderColor:Colors.border, backgroundColor:Colors.white },
  locateBtnText:     { fontSize:10, fontFamily:'Poppins_500Medium', color:Colors.textSecondary },

  emptyWorkers:      { alignItems:'center', gap:4, paddingVertical:16 },
  emptyWorkersText:  { fontSize:13, fontFamily:'Poppins_500Medium', color:Colors.textMuted },
  emptyWorkersSub:   { fontSize:11, fontFamily:'Poppins_400Regular', color:Colors.textMuted },

  selectedWorkerCard:   { marginTop:Spacing.sm, padding:12, borderRadius:10, backgroundColor:'#F8FAFC', borderWidth:1 },
  selectedWorkerHeader: { flexDirection:'row', alignItems:'center', gap:6, marginBottom:6 },
  selectedWorkerTitle:  { fontSize:12, fontFamily:'Poppins_600SemiBold' },
  selectedWorkerText:   { fontSize:12, fontFamily:'Poppins_400Regular', color:Colors.textPrimary },
  selectedWorkerStrong: { fontFamily:'Poppins_600SemiBold' },
  selectedWorkerSub:    { marginTop:4, fontSize:11, fontFamily:'Poppins_400Regular', color:Colors.textSecondary },
});
