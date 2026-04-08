// app/(dashboard)/zones.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
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

const SOLAPUR_LAT = 17.6869;
const SOLAPUR_LNG = 75.9064;

interface WeatherData {
  temp: number;
  humidity: number;
  rain: number;
  windspeed: number;
  weathercode: number;
  description: string;
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

function getWeatherDesc(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 9) return 'Foggy';
  if (code <= 29) return 'Rain / Drizzle';
  if (code <= 49) return 'Freezing drizzle';
  if (code <= 69) return 'Rain';
  if (code <= 79) return 'Snow';
  if (code <= 84) return 'Rain showers';
  if (code <= 94) return 'Thunderstorm';
  return 'Heavy thunderstorm';
}

function analyseWeatherSafety(w: WeatherData): SafetyAnalysis {
  const reasons: string[] = [];
  const recommendations: string[] = [];
  let riskScore = 0;
  let maxDuration = 90;

  if (w.rain >= 50) {
    riskScore += 5;
    maxDuration = 0;
    reasons.push(
      `Extreme rainfall (${w.rain.toFixed(1)} mm/hr) — severe flood risk in sewer lines`
    );
    recommendations.push('Do NOT enter sewer under any circumstances');
  } else if (w.rain >= 20) {
    riskScore += 4;
    maxDuration = 0;
    reasons.push(`Heavy rain (${w.rain.toFixed(1)} mm/hr) — sewer flooding likely`);
    recommendations.push('Entry strictly prohibited — wait for rain to stop');
  } else if (w.rain >= 7) {
    riskScore += 3;
    maxDuration = Math.min(maxDuration, 15);
    reasons.push(`Moderate rain (${w.rain.toFixed(1)} mm/hr) — water surge risk inside`);
    recommendations.push('Emergency entry only — maximum 15 minutes with standby team');
  } else if (w.rain >= 2) {
    riskScore += 2;
    maxDuration = Math.min(maxDuration, 30);
    reasons.push(`Light rain (${w.rain.toFixed(1)} mm/hr) — monitor water levels`);
    recommendations.push('Limit entry to 30 minutes, keep exit clear');
  } else if (w.rain > 0) {
    riskScore += 1;
    maxDuration = Math.min(maxDuration, 60);
    reasons.push('Trace rainfall — minor moisture increase inside sewer');
  }

  if (w.weathercode >= 80) {
    riskScore += 3;
    maxDuration = 0;
    reasons.push('Thunderstorm detected — lightning and flash flood risk');
    recommendations.push('All sewer work suspended until storm clears');
  }

  if (w.temp >= 42) {
    riskScore += 3;
    maxDuration = Math.min(maxDuration, 15);
    reasons.push(`Extreme heat (${w.temp}°C) — heat stroke risk in confined space`);
    recommendations.push('Maximum 15 min inside, mandatory 30 min rest outside');
  } else if (w.temp >= 38) {
    riskScore += 2;
    maxDuration = Math.min(maxDuration, 30);
    reasons.push(`High temperature (${w.temp}°C) — elevated heat stress in sewer`);
    recommendations.push('Carry water, limit to 30 min per entry');
  } else if (w.temp >= 35) {
    riskScore += 1;
    maxDuration = Math.min(maxDuration, 45);
    reasons.push(`Warm conditions (${w.temp}°C) — sewer interior will be hotter`);
    recommendations.push('Hydrate before entry, limit to 45 min');
  }

  if (w.humidity >= 95) {
    riskScore += 2;
    maxDuration = Math.min(maxDuration, 20);
    reasons.push(`Very high humidity (${w.humidity}%) — worsens gas accumulation`);
    recommendations.push('Full respiratory protection required');
  } else if (w.humidity >= 85) {
    riskScore += 1;
    maxDuration = Math.min(maxDuration, 40);
    reasons.push(`High humidity (${w.humidity}%) — increased gas concentration risk`);
    recommendations.push('Enhanced ventilation before entry');
  }

  if (w.windspeed < 5 && w.rain === 0) {
    riskScore += 1;
    reasons.push(
      `Low wind speed (${w.windspeed} km/h) — gases may not disperse from manhole`
    );
    recommendations.push('Ventilate manhole for 5 min before entry');
  }

  let overallRisk: SafetyAnalysis['overallRisk'];
  let verdict: string;
  let color: string;
  let bgColor: string;

  if (riskScore === 0) {
    overallRisk = 'safe';
    verdict = 'Safe to work';
    color = '#27AE60';
    bgColor = '#E8F8F0';
    reasons.push('Weather conditions are favourable for sewer work');
    recommendations.push('Standard pre-monitoring required before entry');
    recommendations.push('Maintain regular sensor checks every 15 minutes');
  } else if (riskScore <= 2) {
    overallRisk = 'caution';
    verdict = 'Proceed with caution';
    color = '#E67E22';
    bgColor = '#FEF9E7';
  } else if (riskScore <= 5) {
    overallRisk = 'danger';
    verdict = 'High risk — entry not recommended';
    color = '#C0392B';
    bgColor = '#FDEDEC';
    if (maxDuration > 0) maxDuration = Math.min(maxDuration, 20);
  } else {
    overallRisk = 'critical';
    verdict = 'CRITICAL — No entry permitted';
    color = '#7B241C';
    bgColor = '#F9EBEA';
    maxDuration = 0;
    recommendations.push('Contact SMC supervisor before any action');
  }

  if (recommendations.length === 0) {
    recommendations.push('Always complete pre-monitoring scan before entry');
    recommendations.push('Keep SurakshaNet sensors active at all times');
  }

  return {
    overallRisk,
    maxDuration,
    verdict,
    reasons,
    recommendations,
    color,
    bgColor,
  };
}

function getZonePolygons(): ZonePolygon[] {
  return [
    {
      id: 'north',
      name: 'North Zone',
      nameM: 'उत्तर विभाग',
      color: '#3B82F6',
      wards: 'North coverage area',
      center: [17.7145, 75.9110],
      coords: [
        [17.7275, 75.9015],
        [17.7275, 75.9215],
        [17.7165, 75.9240],
        [17.7075, 75.9180],
        [17.7075, 75.9050],
        [17.7155, 75.8995],
      ],
    },
    {
      id: 'west',
      name: 'West Zone',
      nameM: 'पश्चिम विभाग',
      color: '#A855F7',
      wards: 'West coverage area',
      center: [17.7005, 75.8905],
      coords: [
        [17.7145, 75.8785],
        [17.7145, 75.9025],
        [17.7045, 75.9075],
        [17.6940, 75.9040],
        [17.6860, 75.8930],
        [17.6895, 75.8815],
        [17.6995, 75.8770],
      ],
    },
    {
      id: 'central',
      name: 'Central Zone',
      nameM: 'मध्य विभाग',
      color: '#EF4444',
      wards: 'Central coverage area',
      center: [17.6895, 75.9075],
      coords: [
        [17.7030, 75.9025],
        [17.7025, 75.9145],
        [17.6950, 75.9200],
        [17.6865, 75.9180],
        [17.6815, 75.9105],
        [17.6830, 75.9015],
        [17.6910, 75.8985],
      ],
    },
    {
      id: 'east',
      name: 'East Zone',
      nameM: 'पूर्व विभाग',
      color: '#F59E0B',
      wards: 'East coverage area',
      center: [17.6925, 75.9235],
      coords: [
        [17.7085, 75.9155],
        [17.7085, 75.9395],
        [17.6955, 75.9435],
        [17.6835, 75.9380],
        [17.6815, 75.9200],
        [17.6890, 75.9130],
      ],
    },
    {
      id: 'south',
      name: 'South Zone',
      nameM: 'दक्षिण विभाग',
      color: '#22C55E',
      wards: 'South coverage area',
      center: [17.6715, 75.9065],
      coords: [
        [17.6845, 75.8945],
        [17.6880, 75.9235],
        [17.6750, 75.9315],
        [17.6615, 75.9255],
        [17.6575, 75.9055],
        [17.6650, 75.8925],
      ],
    },
  ];
}

function buildLeafletHTML(
  selectedZone: string | null,
  focusedManholeId: string | null
): string {
  const allManholes = SOLAPUR_MANHOLES.map((m) => ({
    id: m.id,
    lat: m.lat,
    lng: m.lng,
    zone: m.zone,
    label: m.label,
  }));

  const zonePolygons = getZonePolygons();

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body {
    width:100%;
    height:100%;
    background:#F5F7FB;
    font-family:system-ui,-apple-system,sans-serif;
  }
  #map {
    width:100%;
    height:360px;
  }
  .legend {
    display:flex;
    flex-wrap:wrap;
    gap:8px;
    justify-content:center;
    align-items:center;
    padding:12px;
    background:#fff;
    border-top:1px solid #E5E7EB;
  }
  .leg {
    display:flex;
    align-items:center;
    gap:6px;
    padding:7px 12px;
    border-radius:999px;
    border:1px solid #E2E8F0;
    background:#fff;
    color:#475569;
    font-size:12px;
    font-weight:500;
    cursor:pointer;
    transition:all .2s ease;
  }
  .leg.active {
    font-weight:700;
    box-shadow:0 3px 10px rgba(15,23,42,.08);
  }
  .leg-dot {
    width:10px;
    height:10px;
    border-radius:50%;
    flex-shrink:0;
  }
  .zone-label {
    background:rgba(255,255,255,.94);
    color:#0F172A;
    border:1px solid rgba(148,163,184,.28);
    border-radius:12px;
    padding:5px 9px;
    font-size:10px;
    font-weight:700;
    line-height:1.2;
    text-align:center;
    white-space:nowrap;
    box-shadow:0 2px 10px rgba(0,0,0,.08);
  }
  .zone-label span {
    display:block;
    font-size:8px;
    font-weight:500;
    color:#64748B;
    margin-top:2px;
  }
  .leaflet-container {
    background:#EAF2FB;
  }
  .leaflet-control-zoom {
    border:none !important;
    box-shadow:0 8px 20px rgba(15,23,42,.12) !important;
    overflow:hidden;
    border-radius:16px !important;
  }
  .leaflet-control-zoom a {
    width:36px !important;
    height:36px !important;
    line-height:36px !important;
    color:#0F172A !important;
    font-weight:700;
  }
  .leaflet-popup-content-wrapper {
    border-radius:14px !important;
    box-shadow:0 10px 24px rgba(15,23,42,.16) !important;
  }
  .leaflet-popup-content {
    margin:12px 14px !important;
    font-size:12px;
    line-height:1.55;
    color:#334155;
  }
  .pop-title {
    font-size:13px;
    font-weight:700;
    color:#0F172A;
    margin-bottom:4px;
  }
</style>
</head>
<body>
<div id="map"></div>
<div class="legend" id="legend"></div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<script>
  var SEL = ${JSON.stringify(selectedZone)};
  var FOCUS_MH = ${JSON.stringify(focusedManholeId)};
  var ZONES = ${JSON.stringify(zonePolygons)};
  var MANHOLES = ${JSON.stringify(allManholes)};

  function msg(data) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(data));
    } else {
      window.parent.postMessage(JSON.stringify(data), '*');
    }
  }

  var map = L.map('map', {
    zoomControl: true,
    attributionControl: false
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  L.control.attribution({ prefix: 'OpenStreetMap' }).addTo(map);

  var bounds = [];
  ZONES.forEach(function(z) {
    z.coords.forEach(function(c) { bounds.push(c); });
  });

  if (bounds.length) {
    map.fitBounds(bounds, { padding: [8, 8] });
  } else {
    map.setView([17.6869, 75.9064], 13);
  }

  ZONES.forEach(function(z) {
    var isSel = SEL === z.id;
    var anySelected = SEL !== null;

    var fillOpacity = !anySelected ? 0.20 : (isSel ? 0.30 : 0.06);
    var weight = isSel ? 3 : 2;
    var opacity = isSel ? 1 : 0.9;

    var poly = L.polygon(z.coords, {
      color: z.color,
      weight: weight,
      opacity: opacity,
      fillColor: z.color,
      fillOpacity: fillOpacity,
      smoothFactor: 1.2
    }).addTo(map);

    poly.bindPopup(
      '<div class="pop-title">' + z.name + '</div>' +
      '<div>' + z.nameM + '</div>'
    );

    poly.on('click', function() {
      msg({ type: 'zone', id: z.id });
    });

    var labelIcon = L.divIcon({
      html: '<div class="zone-label">' + z.name + '<span>' + z.nameM + '</span></div>',
      className: '',
      iconSize: [90, 34],
      iconAnchor: [45, 17]
    });

    L.marker(z.center, {
      icon: labelIcon,
      interactive: false,
      keyboard: false
    }).addTo(map);
  });

  var focusedMarker = null;

  MANHOLES.forEach(function(m) {
    var zone = ZONES.find(function(z) { return z.id === m.zone; });
    var isVisible = SEL === null || SEL === m.zone;
    var isFocused = FOCUS_MH !== null && FOCUS_MH === m.id;
    var color = zone ? zone.color : '#1D4ED8';

    var icon = L.divIcon({
      html:
        '<div style="' +
        'width:' + (isFocused ? '14px' : '8px') + ';height:' + (isFocused ? '14px' : '8px') + ';border-radius:999px;' +
        'background:' + color + ';' +
        'border:' + (isFocused ? '2.5px' : '1.5px') + ' solid #ffffff;' +
        'box-shadow:0 2px 5px rgba(0,0,0,.16);' +
        'opacity:' + (isVisible ? '0.95' : '0.18') + ';' +
        '"></div>',
      className: '',
      iconSize: isFocused ? [14, 14] : [8, 8],
      iconAnchor: isFocused ? [7, 7] : [4, 4]
    });

    var marker = L.marker([m.lat, m.lng], { icon: icon }).addTo(map);

    if (isVisible) {
      marker.bindPopup(
        '<div class="pop-title">' + m.id + '</div>' +
        '<div>' + m.label + '</div>' +
        '<div style="margin-top:4px;color:#64748B;">' + (zone ? zone.name : m.zone) + '</div>'
      );

      if (isFocused) {
        focusedMarker = marker;
      }

      marker.on('click', function() {
        msg({ type: 'manhole', id: m.id, zone: m.zone, label: m.label });
      });
    }
  });

  if (focusedMarker) {
    map.setView(focusedMarker.getLatLng(), 17, { animate: true });
    focusedMarker.openPopup();
  }

  var legend = document.getElementById('legend');

  var allBtn = document.createElement('div');
  allBtn.className = 'leg' + (SEL === null ? ' active' : '');
  allBtn.innerHTML = '<div class="leg-dot" style="background:#64748B"></div>All Zones';
  allBtn.onclick = function() {
    msg({ type: 'zone', id: null });
  };
  legend.appendChild(allBtn);

  ZONES.forEach(function(z) {
    var isSel = SEL === z.id;
    var div = document.createElement('div');
    div.className = 'leg' + (isSel ? ' active' : '');
    div.style.borderColor = isSel ? z.color : '#E2E8F0';
    div.style.color = isSel ? z.color : '#475569';
    div.innerHTML = '<div class="leg-dot" style="background:' + z.color + '"></div>' + z.name;
    div.onclick = function() {
      msg({ type: 'zone', id: z.id });
    };
    legend.appendChild(div);
  });
<\/script>
</body>
</html>`;
}

function SolapurMap({
  selectedZone,
  focusedManholeId,
  onSelectZone,
}: {
  selectedZone: string | null;
  focusedManholeId: string | null;
  onSelectZone: (id: string | null) => void;
}) {
  const html = buildLeafletHTML(selectedZone, focusedManholeId);

  const onMsg = React.useCallback((data: string) => {
    try {
      const m = JSON.parse(data);

      if (m.type === 'zone') {
        if (m.id === null) {
          onSelectZone(null);
        } else {
          onSelectZone(m.id === selectedZone ? null : m.id);
        }
      }
    } catch {}
  }, [selectedZone, onSelectZone]);

  if (Platform.OS === 'web') {
    return <WebLeafletMap html={html} onMessage={onMsg} />;
  }

  return <NativeLeafletMap html={html} onMessage={onMsg} />;
}

function WebLeafletMap({
  html,
  onMessage,
}: {
  html: string;
  onMessage: (d: string) => void;
}) {
  useEffect(() => {
    const handler = (e: any) => {
      try {
        onMessage(e.data);
      } catch {}
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onMessage]);

  if (typeof document === 'undefined') return null;

  return (
    <iframe
      srcDoc={html}
      style={{ width: '100%', height: 420, border: 'none', borderRadius: 12 } as any}
    />
  );
}

function NativeLeafletMap({
  html,
  onMessage,
}: {
  html: string;
  onMessage: (d: string) => void;
}) {
  let WebView: any = null;

  try {
    WebView = require('react-native-webview').WebView;
  } catch {}

  if (!WebView) {
    return (
      <View style={mapSt.fallback}>
        <MaterialCommunityIcons
          name="map"
          size={36}
          color={Colors.primary}
          style={{ opacity: 0.4 }}
        />
        <Text style={mapSt.fallbackTitle}>Interactive Map</Text>
        <Text style={mapSt.fallbackSub}>
          Run: npx expo install react-native-webview
        </Text>

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
    backgroundColor: Colors.white,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    minHeight: 200,
    justifyContent: 'center',
  },
  fallbackTitle: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: Colors.primary,
  },
  fallbackSub: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    fontFamily: 'Poppins_400Regular',
    color: Colors.textSecondary,
  },
});

function WeatherAnalysisPanel() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');

  const fetchWeather = async () => {
    setLoading(true);
    setError(false);

    try {
      const url =
        'https://api.open-meteo.com/v1/forecast?latitude=' +
        SOLAPUR_LAT +
        '&longitude=' +
        SOLAPUR_LNG +
        '&current=temperature_2m,relative_humidity_2m,precipitation,windspeed_10m,weathercode&timezone=Asia%2FKolkata';

      const res = await fetch(url);
      const json = await res.json();
      const c = json.current;

      setWeather({
        temp: Math.round(c.temperature_2m * 10) / 10,
        humidity: Math.round(c.relative_humidity_2m),
        rain: Math.round(c.precipitation * 10) / 10,
        windspeed: Math.round(c.windspeed_10m * 10) / 10,
        weathercode: c.weathercode,
        description: getWeatherDesc(c.weathercode),
      });

      const now = new Date();
      setLastUpdated(
        now.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })
      );
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWeather();
  }, []);

  const analysis = weather ? analyseWeatherSafety(weather) : null;

  const riskIcon = (r: string) =>
    r === 'safe'
      ? 'shield-check'
      : r === 'caution'
      ? 'alert'
      : r === 'danger'
      ? 'alert-circle'
      : 'close-octagon';

  return (
    <View style={wx.card}>
      <View style={wx.header}>
        <View style={wx.headerLeft}>
          <MaterialCommunityIcons
            name="weather-partly-cloudy"
            size={20}
            color={Colors.primary}
          />
          <Text style={wx.title}>Weather + AI Safety Analysis</Text>
        </View>

        <TouchableOpacity onPress={fetchWeather} style={wx.refreshBtn}>
          <MaterialCommunityIcons name="refresh" size={16} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <Text style={wx.sub}>Solapur, Maharashtra · Open-Meteo (free)</Text>

      {loading && (
        <View style={wx.loadingRow}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={wx.loadingText}>Fetching live weather data...</Text>
        </View>
      )}

      {error && !loading && (
        <View style={wx.errorRow}>
          <MaterialCommunityIcons name="wifi-off" size={16} color={Colors.danger} />
          <Text style={wx.errorText}>Could not fetch weather. Check connection.</Text>
          <TouchableOpacity onPress={fetchWeather}>
            <Text style={wx.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {weather && !loading && (
        <>
          <View style={wx.metricsRow}>
            <View style={wx.metric}>
              <MaterialCommunityIcons name="thermometer" size={18} color="#E67E22" />
              <Text style={wx.metricVal}>{weather.temp}°C</Text>
              <Text style={wx.metricLabel}>Temp</Text>
            </View>

            <View style={wx.metric}>
              <MaterialCommunityIcons name="water-percent" size={18} color="#3498DB" />
              <Text style={wx.metricVal}>{weather.humidity}%</Text>
              <Text style={wx.metricLabel}>Humidity</Text>
            </View>

            <View style={wx.metric}>
              <MaterialCommunityIcons name="weather-rainy" size={18} color="#2980B9" />
              <Text style={wx.metricVal}>{weather.rain} mm</Text>
              <Text style={wx.metricLabel}>Rain/hr</Text>
            </View>

            <View style={wx.metric}>
              <MaterialCommunityIcons name="weather-windy" size={18} color="#7F8C8D" />
              <Text style={wx.metricVal}>{weather.windspeed}</Text>
              <Text style={wx.metricLabel}>km/h</Text>
            </View>
          </View>

          <View style={wx.conditionRow}>
            <MaterialCommunityIcons
              name="cloud-outline"
              size={13}
              color={Colors.textSecondary}
            />
            <Text style={wx.conditionText}>{weather.description}</Text>
            {lastUpdated ? <Text style={wx.updatedText}>Updated {lastUpdated}</Text> : null}
          </View>

          <View style={wx.divider} />

          {analysis && (
            <>
              <View
                style={[
                  wx.verdictBanner,
                  { backgroundColor: analysis.bgColor, borderColor: analysis.color },
                ]}
              >
                <MaterialCommunityIcons
                  name={riskIcon(analysis.overallRisk) as any}
                  size={26}
                  color={analysis.color}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[wx.verdictTitle, { color: analysis.color }]}>
                    {analysis.verdict}
                  </Text>
                  <Text style={[wx.verdictDuration, { color: analysis.color }]}>
                    {analysis.maxDuration > 0
                      ? 'Max safe duration inside: ' + analysis.maxDuration + ' minutes'
                      : 'Entry not permitted right now'}
                  </Text>
                </View>
              </View>

              <Text style={wx.sectionLabel}>WHY</Text>
              {analysis.reasons.map((reason, index) => (
                <View key={index} style={wx.reasonRow}>
                  <View style={[wx.reasonDot, { backgroundColor: analysis.color }]} />
                  <Text style={wx.reasonText}>{reason}</Text>
                </View>
              ))}

              <Text style={[wx.sectionLabel, { marginTop: 10 }]}>RECOMMENDATIONS</Text>
              {analysis.recommendations.map((recommendation, index) => (
                <View key={index} style={wx.recRow}>
                  <MaterialCommunityIcons
                    name="checkbox-marked-circle-outline"
                    size={14}
                    color={Colors.success}
                  />
                  <Text style={wx.recText}>{recommendation}</Text>
                </View>
              ))}

              <View style={wx.noteRow}>
                <MaterialCommunityIcons
                  name="information-outline"
                  size={12}
                  color={Colors.textMuted}
                />
                <Text style={wx.noteText}>
                  AI analysis based on weather thresholds. Always complete sensor
                  pre-monitoring before entry.
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
  card: {
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    ...Shadows.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: Colors.textPrimary,
  },
  sub: {
    fontSize: 11,
    fontFamily: 'Poppins_400Regular',
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  refreshBtn: { padding: 4 },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  loadingText: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: Colors.textSecondary,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  errorText: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: Colors.danger,
    flex: 1,
  },
  retryText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: Colors.primary,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  metric: {
    alignItems: 'center',
    gap: 3,
    flex: 1,
  },
  metricVal: {
    fontSize: 15,
    fontFamily: 'Poppins_700Bold',
    color: Colors.textPrimary,
  },
  metricLabel: {
    fontSize: 10,
    fontFamily: 'Poppins_400Regular',
    color: Colors.textSecondary,
  },
  conditionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 12,
  },
  conditionText: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: Colors.textSecondary,
    flex: 1,
  },
  updatedText: {
    fontSize: 10,
    fontFamily: 'Poppins_400Regular',
    color: Colors.textMuted,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginBottom: 12,
  },
  verdictBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 8,
    padding: 12,
    borderWidth: 1.5,
    marginBottom: 14,
  },
  verdictTitle: {
    fontSize: 14,
    fontFamily: 'Poppins_700Bold',
  },
  verdictDuration: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: 10,
    fontFamily: 'Poppins_700Bold',
    color: Colors.textMuted,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 5,
  },
  reasonDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 5,
    flexShrink: 0,
  },
  reasonText: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: Colors.textPrimary,
    flex: 1,
    lineHeight: 18,
  },
  recRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 5,
  },
  recText: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: Colors.textPrimary,
    flex: 1,
    lineHeight: 18,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    marginTop: 10,
    padding: 8,
    backgroundColor: Colors.infoBg,
    borderRadius: 6,
  },
  noteText: {
    fontSize: 10,
    fontFamily: 'Poppins_400Regular',
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 15,
  },
});

export default function ZonesScreen() {
  const { language, workers, sensors, alerts } = useStore();
  const T = getText(language);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [focusedManholeId, setFocusedManholeId] = useState<string | null>(null);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{T.dashboard.zones}</Text>
        <Text style={styles.headerSub}>Solapur City — 5 Zones</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        <View style={styles.mapCard}>
          <SolapurMap
            selectedZone={selectedZone}
            focusedManholeId={focusedManholeId}
            onSelectZone={(id) => {
              setSelectedZone(id);
              setFocusedManholeId(null);
            }}
          />
        </View>

        <View style={styles.section}>
          <WeatherAnalysisPanel />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Zone Details</Text>

          {SOLAPUR_ZONES.map((zone) => {
            const zoneWorkers = workers.filter((w) => w.zone === zone.id);

            const safeWorkers = zoneWorkers.filter((w) => {
              const s = sensors[w.id];
              return !s || getSafetyStatus(s) === 'safe';
            });

            const dangerWorkers = zoneWorkers.filter((w) => {
              const s = sensors[w.id];
              return s && getSafetyStatus(s) === 'danger';
            });

            const warningWorkers = zoneWorkers.filter((w) => {
              const s = sensors[w.id];
              return s && getSafetyStatus(s) === 'warning';
            });

            const zoneAlerts = alerts.filter((a) => a.zone === zone.id && !a.resolved);
            const isSelected = selectedZone === zone.id;

            return (
              <TouchableOpacity
                key={zone.id}
                style={[
                  styles.zoneCard,
                  isSelected && styles.zoneCardSelected,
                  { borderLeftColor: zone.color },
                ]}
                onPress={() => {
                  setSelectedZone(isSelected ? null : zone.id);
                  setFocusedManholeId(null);
                }}
              >
                <View style={styles.zoneCardHeader}>
                  <View
                    style={[
                      styles.zoneIconBg,
                      { backgroundColor: zone.color + '18' },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="map-marker-radius"
                      size={22}
                      color={zone.color}
                    />
                  </View>

                  <View style={styles.zoneCardInfo}>
                    <Text style={styles.zoneName}>{zone.name}</Text>
                    <Text style={styles.zoneNameMr}>{zone.nameMarathi}</Text>
                  </View>

                  {zoneAlerts.length > 0 && (
                    <View
                      style={[
                        styles.alertBadge,
                        { backgroundColor: Colors.danger },
                      ]}
                    >
                      <Text style={styles.alertBadgeText}>
                        {zoneAlerts.length} alert{zoneAlerts.length > 1 ? 's' : ''}
                      </Text>
                    </View>
                  )}

                  <MaterialCommunityIcons
                    name={isSelected ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={Colors.textMuted}
                  />
                </View>

                <View style={styles.statusRow}>
                  <View style={styles.statusItem}>
                    <MaterialCommunityIcons
                      name="account-group"
                      size={16}
                      color={Colors.primary}
                    />
                    <Text style={styles.statusItemText}>{zoneWorkers.length} total</Text>
                  </View>

                  <View style={styles.statusItem}>
                    <MaterialCommunityIcons
                      name="shield-check"
                      size={16}
                      color={Colors.success}
                    />
                    <Text style={[styles.statusItemText, { color: Colors.success }]}>
                      {safeWorkers.length} safe
                    </Text>
                  </View>

                  {warningWorkers.length > 0 && (
                    <View style={styles.statusItem}>
                      <MaterialCommunityIcons
                        name="alert"
                        size={16}
                        color={Colors.warning}
                      />
                      <Text style={[styles.statusItemText, { color: Colors.warning }]}>
                        {warningWorkers.length} warn
                      </Text>
                    </View>
                  )}

                  {dangerWorkers.length > 0 && (
                    <View style={styles.statusItem}>
                      <MaterialCommunityIcons
                        name="alarm-light"
                        size={16}
                        color={Colors.danger}
                      />
                      <Text style={[styles.statusItemText, { color: Colors.danger }]}>
                        {dangerWorkers.length} danger
                      </Text>
                    </View>
                  )}
                </View>

                {isSelected && (
                  <View style={styles.wardsSection}>
                    <Text style={styles.wardsTitle}>Coverage Areas:</Text>

                    <View style={styles.wardsList}>
                      {zone.wards.map((ward) => (
                        <View
                          key={ward}
                          style={[styles.wardChip, { borderColor: zone.color }]}
                        >
                          <Text style={[styles.wardChipText, { color: zone.color }]}>
                            {ward}
                          </Text>
                        </View>
                      ))}
                    </View>

                    {zoneWorkers.length > 0 && (
                      <>
                        <Text style={[styles.wardsTitle, { marginTop: Spacing.sm }]}>
                          Active Workers:
                        </Text>

                        {zoneWorkers.map((w) => {
                          const s = sensors[w.id];
                          const st = s ? getSafetyStatus(s) : 'safe';
                          const stColor =
                            st === 'safe'
                              ? Colors.success
                              : st === 'warning'
                              ? Colors.warning
                              : Colors.danger;

                          return (
                            <TouchableOpacity
                              key={w.id}
                              style={styles.workerRow}
                              onPress={() => {
                                const mhId = s?.manholeId || null;
                                setSelectedZone(zone.id);
                                setFocusedManholeId(mhId);
                              }}
                              activeOpacity={0.75}
                            >
                              <MaterialCommunityIcons
                                name="account-hard-hat"
                                size={16}
                                color={Colors.textSecondary}
                              />
                              <Text style={styles.workerRowName}>{w.name}</Text>
                              <View
                                style={[
                                  styles.workerStatusDot,
                                  { backgroundColor: stColor },
                                ]}
                              />
                              <Text
                                style={[styles.workerStatusText, { color: stColor }]}
                              >
                                {st}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  headerTitle: {
    color: Colors.white,
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
  },
  headerSub: {
    color: '#B8C8D8',
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
  },
  mapCard: {
    margin: Spacing.md,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    ...Shadows.md,
  },
  section: {
    padding: Spacing.md,
    paddingTop: 0,
    gap: Spacing.sm,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Poppins_600SemiBold',
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  zoneCard: {
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderLeftWidth: 4,
    ...Shadows.sm,
  },
  zoneCardSelected: { ...Shadows.md },
  zoneCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  zoneIconBg: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoneCardInfo: { flex: 1 },
  zoneName: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: Colors.textPrimary,
  },
  zoneNameMr: {
    fontSize: 11,
    fontFamily: 'Poppins_400Regular',
    color: Colors.textSecondary,
  },
  alertBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
  },
  alertBadgeText: {
    color: Colors.white,
    fontSize: 10,
    fontFamily: 'Poppins_600SemiBold',
  },
  statusRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingTop: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusItemText: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: Colors.textSecondary,
  },
  wardsSection: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  wardsTitle: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  wardsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  wardChip: {
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  wardChipText: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
  },
  workerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  workerRowName: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: Colors.textPrimary,
  },
  workerStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  workerStatusText: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
  },
});