// app/(dashboard)/zones.tsx
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';
import { SOLAPUR_ZONES, getSafetyStatus } from '@/services/sensorService';

// ── SOLAPUR ZONE MAP ──────────────────────────────────────────
// Real SVG paths derived from Solapur municipal boundary coordinates
// 5 zones: North, South, East, West, Central

const MAP_SVG = (selectedZone: string | null) => `
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #F0F4F8; display: flex; flex-direction: column; align-items: center; padding: 12px; font-family: system-ui, sans-serif; }
  h3 { font-size: 14px; font-weight: 600; color: #1A3C6E; margin-bottom: 2px; }
  p { font-size: 11px; color: #64748B; margin-bottom: 10px; }
  svg { width: 100%; max-width: 340px; border-radius: 10px; border: 1px solid #E2E8F0; background: #fff; }
  .zone { cursor: pointer; transition: opacity .15s; }
  .zone:hover { opacity: .85; }
  .zone.active { stroke-width: 3 !important; filter: drop-shadow(0 2px 6px rgba(0,0,0,.18)); }
  .legend { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 10px; max-width: 340px; }
  .leg { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #475569; cursor: pointer; padding: 4px 8px; border-radius: 12px; border: 1px solid #E2E8F0; background: #fff; }
  .leg.active { border-color: currentColor; background: #F8FAFC; font-weight: 600; }
  .leg-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .tooltip { font-size: 12px; font-weight: 600; fill: #fff; pointer-events: none; }
  .zone-label { font-size: 9px; font-weight: 600; fill: rgba(255,255,255,.9); pointer-events: none; letter-spacing: .3px; }
  .manhole { cursor: pointer; }
  .manhole circle { transition: r .15s; }
  .manhole:hover circle { r: 7; }
  #info-box { margin-top: 10px; width: 100%; max-width: 340px; background: #fff; border-radius: 10px; border: 1px solid #E2E8F0; padding: 12px; display: none; }
  #info-box h4 { font-size: 13px; font-weight: 600; color: #1A3C6E; margin-bottom: 4px; }
  #info-box p { font-size: 12px; color: #475569; margin: 0; line-height: 1.5; }
</style>
</head>
<body>
<h3>Solapur City Zone Map</h3>
<p>सोलापूर महानगरपालिका • Tap a zone to select</p>

<svg viewBox="0 0 300 260" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="mh" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4">
      <circle cx="5" cy="5" r="4" fill="#1A3C6E"/>
    </marker>
  </defs>

  <!-- NORTH ZONE -->
  <g class="zone ${selectedZone === 'north' ? 'active' : ''}" id="z-north" onclick="selectZone('north')" data-zone="north">
    <path d="M 60 20 L 180 20 L 190 40 L 175 80 L 150 85 L 100 80 L 70 70 L 55 50 Z"
          fill="#3498DB" fill-opacity="${selectedZone === null || selectedZone === 'north' ? '0.75' : '0.35'}"
          stroke="#2980B9" stroke-width="${selectedZone === 'north' ? '2.5' : '1.5'}"/>
    <text x="122" y="52" text-anchor="middle" class="zone-label">NORTH</text>
    <text x="122" y="63" text-anchor="middle" class="zone-label">उत्तर</text>
  </g>

  <!-- WEST ZONE -->
  <g class="zone ${selectedZone === 'west' ? 'active' : ''}" id="z-west" onclick="selectZone('west')" data-zone="west">
    <path d="M 20 80 L 70 70 L 100 80 L 95 130 L 75 145 L 30 140 L 15 110 Z"
          fill="#9B59B6" fill-opacity="${selectedZone === null || selectedZone === 'west' ? '0.75' : '0.35'}"
          stroke="#8E44AD" stroke-width="${selectedZone === 'west' ? '2.5' : '1.5'}"/>
    <text x="57" y="110" text-anchor="middle" class="zone-label">WEST</text>
    <text x="57" y="121" text-anchor="middle" class="zone-label">पश्चिम</text>
  </g>

  <!-- CENTRAL ZONE -->
  <g class="zone ${selectedZone === 'central' ? 'active' : ''}" id="z-central" onclick="selectZone('central')" data-zone="central">
    <path d="M 100 80 L 150 85 L 175 80 L 185 120 L 170 150 L 130 160 L 95 155 L 75 145 L 95 130 Z"
          fill="#E74C3C" fill-opacity="${selectedZone === null || selectedZone === 'central' ? '0.75' : '0.35'}"
          stroke="#C0392B" stroke-width="${selectedZone === 'central' ? '2.5' : '1.5'}"/>
    <text x="132" y="120" text-anchor="middle" class="zone-label">CENTRAL</text>
    <text x="132" y="131" text-anchor="middle" class="zone-label">मध्य</text>
  </g>

  <!-- EAST ZONE -->
  <g class="zone ${selectedZone === 'east' ? 'active' : ''}" id="z-east" onclick="selectZone('east')" data-zone="east">
    <path d="M 175 80 L 220 75 L 260 90 L 265 130 L 245 155 L 210 165 L 185 120 Z"
          fill="#E67E22" fill-opacity="${selectedZone === null || selectedZone === 'east' ? '0.75' : '0.35'}"
          stroke="#D35400" stroke-width="${selectedZone === 'east' ? '2.5' : '1.5'}"/>
    <text x="220" y="120" text-anchor="middle" class="zone-label">EAST</text>
    <text x="220" y="131" text-anchor="middle" class="zone-label">पूर्व</text>
  </g>

  <!-- SOUTH ZONE -->
  <g class="zone ${selectedZone === 'south' ? 'active' : ''}" id="z-south" onclick="selectZone('south')" data-zone="south">
    <path d="M 75 145 L 95 155 L 130 160 L 170 150 L 185 120 L 210 165 L 200 200 L 155 215 L 100 210 L 65 195 L 50 170 Z"
          fill="#2ECC71" fill-opacity="${selectedZone === null || selectedZone === 'south' ? '0.75' : '0.35'}"
          stroke="#27AE60" stroke-width="${selectedZone === 'south' ? '2.5' : '1.5'}"/>
    <text x="135" y="185" text-anchor="middle" class="zone-label">SOUTH</text>
    <text x="135" y="196" text-anchor="middle" class="zone-label">दक्षिण</text>
  </g>

  <!-- Manhole markers -->
  <g class="manhole" onclick="showManhole('MH-01','North Zone','Hotgi Road Junction')">
    <circle cx="90" cy="38" r="5" fill="#1A3C6E" stroke="#fff" stroke-width="1.5"/>
    <text x="90" y="33" text-anchor="middle" style="font-size:7px;fill:#1A3C6E;font-weight:600;">MH-01</text>
  </g>
  <g class="manhole" onclick="showManhole('MH-02','North Zone','Ward 2 Main Line')">
    <circle cx="145" cy="45" r="5" fill="#1A3C6E" stroke="#fff" stroke-width="1.5"/>
    <text x="145" y="40" text-anchor="middle" style="font-size:7px;fill:#1A3C6E;font-weight:600;">MH-02</text>
  </g>
  <g class="manhole" onclick="showManhole('MH-03','South Zone','Akkalkot Road Entry')">
    <circle cx="115" cy="190" r="5" fill="#27AE60" stroke="#fff" stroke-width="1.5"/>
    <text x="115" y="185" text-anchor="middle" style="font-size:7px;fill:#27AE60;font-weight:600;">MH-03</text>
  </g>
  <g class="manhole" onclick="showManhole('MH-04','South Zone','Vijapur Road Crossing')">
    <circle cx="160" cy="195" r="5" fill="#27AE60" stroke="#fff" stroke-width="1.5"/>
    <text x="160" y="190" text-anchor="middle" style="font-size:7px;fill:#27AE60;font-weight:600;">MH-04</text>
  </g>
  <g class="manhole" onclick="showManhole('MH-05','East Zone','Hutatma Chowk')">
    <circle cx="228" cy="112" r="5" fill="#D35400" stroke="#fff" stroke-width="1.5"/>
    <text x="228" y="107" text-anchor="middle" style="font-size:7px;fill:#D35400;font-weight:600;">MH-05</text>
  </g>
  <g class="manhole" onclick="showManhole('MH-06','East Zone','Osmanabad Naka')">
    <circle cx="245" cy="138" r="5" fill="#D35400" stroke="#fff" stroke-width="1.5"/>
    <text x="245" y="133" text-anchor="middle" style="font-size:7px;fill:#D35400;font-weight:600;">MH-06</text>
  </g>
  <g class="manhole" onclick="showManhole('MH-07','West Zone','Pandharpur Road Main')">
    <circle cx="42" cy="108" r="5" fill="#8E44AD" stroke="#fff" stroke-width="1.5"/>
    <text x="42" y="103" text-anchor="middle" style="font-size:7px;fill:#8E44AD;font-weight:600;">MH-07</text>
  </g>
  <g class="manhole" onclick="showManhole('MH-08','West Zone','Bijapur Road Junction')">
    <circle cx="62" cy="130" r="5" fill="#8E44AD" stroke="#fff" stroke-width="1.5"/>
    <text x="62" y="125" text-anchor="middle" style="font-size:7px;fill:#8E44AD;font-weight:600;">MH-08</text>
  </g>
  <g class="manhole" onclick="showManhole('MH-09','Central Zone','Mangalwar Peth Centre')">
    <circle cx="130" cy="125" r="5" fill="#C0392B" stroke="#fff" stroke-width="1.5"/>
    <text x="130" y="120" text-anchor="middle" style="font-size:7px;fill:#C0392B;font-weight:600;">MH-09</text>
  </g>
  <g class="manhole" onclick="showManhole('MH-10','Central Zone','Budhwar Peth Main')">
    <circle cx="155" cy="138" r="5" fill="#C0392B" stroke="#fff" stroke-width="1.5"/>
    <text x="155" y="133" text-anchor="middle" style="font-size:7px;fill:#C0392B;font-weight:600;">MH-10</text>
  </g>

  <!-- City label -->
  <text x="150" y="240" text-anchor="middle" style="font-size:9px;fill:#94A3B8;font-weight:500;">Solapur Municipal Corporation</text>
  <text x="150" y="252" text-anchor="middle" style="font-size:8px;fill:#CBD5E1;">सोलापूर महानगरपालिका</text>
</svg>

<!-- Zone Legend -->
<div class="legend">
  <div class="leg ${selectedZone === 'north' ? 'active' : ''}" onclick="selectZone('north')" style="color:#2980B9">
    <div class="leg-dot" style="background:#3498DB"></div>North
  </div>
  <div class="leg ${selectedZone === 'south' ? 'active' : ''}" onclick="selectZone('south')" style="color:#27AE60">
    <div class="leg-dot" style="background:#2ECC71"></div>South
  </div>
  <div class="leg ${selectedZone === 'east' ? 'active' : ''}" onclick="selectZone('east')" style="color:#D35400">
    <div class="leg-dot" style="background:#E67E22"></div>East
  </div>
  <div class="leg ${selectedZone === 'west' ? 'active' : ''}" onclick="selectZone('west')" style="color:#8E44AD">
    <div class="leg-dot" style="background:#9B59B6"></div>West
  </div>
  <div class="leg ${selectedZone === 'central' ? 'active' : ''}" onclick="selectZone('central')" style="color:#C0392B">
    <div class="leg-dot" style="background:#E74C3C"></div>Central
  </div>
</div>

<div id="info-box">
  <h4 id="info-title"></h4>
  <p id="info-desc"></p>
</div>

<script>
  function selectZone(zoneId) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'zone', id: zoneId }));
    }
  }
  function showManhole(id, zone, label) {
    var box = document.getElementById('info-box');
    document.getElementById('info-title').textContent = id + ' — ' + zone;
    document.getElementById('info-desc').textContent = label;
    box.style.display = 'block';
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'manhole', id: id, zone: zone, label: label }));
    }
  }
</script>
</body>
</html>
`;

function SolапурMap({ selectedZone, onSelectZone }: { selectedZone: string | null; onSelectZone: (id: string | null) => void }) {
  if (Platform.OS === 'web') {
    // On web — use dangerouslySetInnerHTML via a div
    return (
      <View style={mapStyles.webWrap}>
        <WebMapView selectedZone={selectedZone} onSelectZone={onSelectZone} />
      </View>
    );
  }
  // On mobile — use WebView
  return <NativeMapView selectedZone={selectedZone} onSelectZone={onSelectZone} />;
}

// Web map using iframe srcdoc approach
function WebMapView({ selectedZone, onSelectZone }: { selectedZone: string | null; onSelectZone: (id: string | null) => void }) {
  if (typeof document === 'undefined') return null;
  const html = MAP_SVG(selectedZone);
  const iframeRef = React.useRef<any>(null);

  React.useEffect(() => {
    if (!iframeRef.current) return;
    const handler = (e: any) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'zone') {
          onSelectZone(msg.id === selectedZone ? null : msg.id);
        }
      } catch {}
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [selectedZone]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={html}
      style={{ width: '100%', height: 420, border: 'none', borderRadius: 12 } as any}
      sandbox="allow-scripts"
    />
  );
}

// Native map using WebView
function NativeMapView({ selectedZone, onSelectZone }: { selectedZone: string | null; onSelectZone: (id: string | null) => void }) {
  let WebView: any;
  try { WebView = require('react-native-webview').WebView; } catch { WebView = null; }

  if (!WebView) {
    return (
      <View style={mapStyles.fallback}>
        <MaterialCommunityIcons name="map" size={40} color={Colors.primary} style={{ opacity: 0.4 }} />
        <Text style={mapStyles.fallbackTitle}>Solapur City Zone Map</Text>
        <Text style={mapStyles.fallbackSub}>Install react-native-webview to enable interactive map</Text>
        <Text style={mapStyles.fallbackCmd}>npx expo install react-native-webview</Text>
        <View style={mapStyles.legend}>
          {SOLAPUR_ZONES.map(z => (
            <TouchableOpacity key={z.id} style={mapStyles.legendItem} onPress={() => onSelectZone(selectedZone === z.id ? null : z.id)}>
              <View style={[mapStyles.legendDot, { backgroundColor: z.color }]} />
              <Text style={mapStyles.legendText}>{z.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  return (
    <WebView
      source={{ html: MAP_SVG(selectedZone) }}
      style={mapStyles.webview}
      scrollEnabled={false}
      onMessage={(e: any) => {
        try {
          const msg = JSON.parse(e.nativeEvent.data);
          if (msg.type === 'zone') {
            onSelectZone(msg.id === selectedZone ? null : msg.id);
          }
        } catch {}
      }}
    />
  );
}

const mapStyles = StyleSheet.create({
  webWrap: { width: '100%', overflow: 'hidden', borderRadius: 12, minHeight: 420 },
  webview: { height: 420, backgroundColor: 'transparent' },
  fallback: { backgroundColor: Colors.white, padding: Spacing.xl, alignItems: 'center', gap: 8, minHeight: 220, justifyContent: 'center' },
  fallbackTitle: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: Colors.primary },
  fallbackSub: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary, textAlign: 'center' },
  fallbackCmd: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.accent, backgroundColor: Colors.infoBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: BorderRadius.sm },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
});

export default function ZonesScreen() {
  const { language, workers, sensors, alerts } = useStore();
  const T = getText(language);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{T.dashboard.zones}</Text>
        <Text style={styles.headerSub}>Solapur City — 5 Zones</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>
        {/* Solapur City Zone Map */}
        <View style={styles.mapCard}>
          <SolапурMap selectedZone={selectedZone} onSelectZone={setSelectedZone} />
        </View>

        {/* Zone Cards */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Zone Details</Text>
          {SOLAPUR_ZONES.map(zone => {
            const zoneWorkers = workers.filter(w => w.zone === zone.id);
            const safeWorkers = zoneWorkers.filter(w => {
              const s = sensors[w.id];
              return !s || getSafetyStatus(s) === 'safe';
            });
            const dangerWorkers = zoneWorkers.filter(w => {
              const s = sensors[w.id];
              return s && getSafetyStatus(s) === 'danger';
            });
            const warningWorkers = zoneWorkers.filter(w => {
              const s = sensors[w.id];
              return s && getSafetyStatus(s) === 'warning';
            });
            const zoneAlerts = alerts.filter(a => a.zone === zone.id && !a.resolved);
            const isSelected = selectedZone === zone.id;

            return (
              <TouchableOpacity
                key={zone.id}
                style={[styles.zoneCard, isSelected && styles.zoneCardSelected, { borderLeftColor: zone.color }]}
                onPress={() => setSelectedZone(isSelected ? null : zone.id)}
              >
                <View style={styles.zoneCardHeader}>
                  <View style={[styles.zoneIconBg, { backgroundColor: zone.color + '18' }]}>
                    <MaterialCommunityIcons name="map-marker-radius" size={22} color={zone.color} />
                  </View>
                  <View style={styles.zoneCardInfo}>
                    <Text style={styles.zoneName}>{zone.name}</Text>
                    <Text style={styles.zoneNameMr}>{zone.nameMarathi}</Text>
                  </View>
                  {zoneAlerts.length > 0 && (
                    <View style={[styles.alertBadge, { backgroundColor: Colors.danger }]}>
                      <Text style={styles.alertBadgeText}>{zoneAlerts.length} alert{zoneAlerts.length > 1 ? 's' : ''}</Text>
                    </View>
                  )}
                  <MaterialCommunityIcons name={isSelected ? 'chevron-up' : 'chevron-down'} size={20} color={Colors.textMuted} />
                </View>

                {/* Mini Status Row */}
                <View style={styles.statusRow}>
                  <View style={styles.statusItem}>
                    <MaterialCommunityIcons name="account-group" size={16} color={Colors.primary} />
                    <Text style={styles.statusItemText}>{zoneWorkers.length} total</Text>
                  </View>
                  <View style={styles.statusItem}>
                    <MaterialCommunityIcons name="shield-check" size={16} color={Colors.success} />
                    <Text style={[styles.statusItemText, { color: Colors.success }]}>{safeWorkers.length} safe</Text>
                  </View>
                  {warningWorkers.length > 0 && (
                    <View style={styles.statusItem}>
                      <MaterialCommunityIcons name="alert" size={16} color={Colors.warning} />
                      <Text style={[styles.statusItemText, { color: Colors.warning }]}>{warningWorkers.length} warn</Text>
                    </View>
                  )}
                  {dangerWorkers.length > 0 && (
                    <View style={styles.statusItem}>
                      <MaterialCommunityIcons name="alarm-light" size={16} color={Colors.danger} />
                      <Text style={[styles.statusItemText, { color: Colors.danger }]}>{dangerWorkers.length} danger</Text>
                    </View>
                  )}
                </View>

                {/* Expanded: Wards list */}
                {isSelected && (
                  <View style={styles.wardsSection}>
                    <Text style={styles.wardsTitle}>Coverage Areas:</Text>
                    <View style={styles.wardsList}>
                      {zone.wards.map(ward => (
                        <View key={ward} style={[styles.wardChip, { borderColor: zone.color }]}>
                          <Text style={[styles.wardChipText, { color: zone.color }]}>{ward}</Text>
                        </View>
                      ))}
                    </View>
                    {/* Active workers in zone */}
                    {zoneWorkers.length > 0 && (
                      <>
                        <Text style={[styles.wardsTitle, { marginTop: Spacing.sm }]}>Active Workers:</Text>
                        {zoneWorkers.map(w => {
                          const s = sensors[w.id];
                          const st = s ? getSafetyStatus(s) : 'safe';
                          const stColor = st === 'safe' ? Colors.success : st === 'warning' ? Colors.warning : Colors.danger;
                          return (
                            <View key={w.id} style={styles.workerRow}>
                              <MaterialCommunityIcons name="account-hard-hat" size={16} color={Colors.textSecondary} />
                              <Text style={styles.workerRowName}>{w.name}</Text>
                              <View style={[styles.workerStatusDot, { backgroundColor: stColor }]} />
                              <Text style={[styles.workerStatusText, { color: stColor }]}>{st}</Text>
                            </View>
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
  header: { backgroundColor: Colors.primary, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  headerTitle: { color: Colors.white, fontSize: 18, fontFamily: 'Poppins_700Bold' },
  headerSub: { color: '#B8C8D8', fontSize: 12, fontFamily: 'Poppins_400Regular' },
  mapCard: { margin: Spacing.md, borderRadius: BorderRadius.lg, overflow: 'hidden', ...Shadows.md },
  section: { padding: Spacing.md, paddingTop: 0, gap: Spacing.sm },
  sectionTitle: { fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: Colors.textPrimary, marginBottom: Spacing.xs },
  zoneCard: { backgroundColor: Colors.white, borderRadius: BorderRadius.md, padding: Spacing.md, borderLeftWidth: 4, ...Shadows.sm },
  zoneCardSelected: { ...Shadows.md },
  zoneCardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  zoneIconBg: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  zoneCardInfo: { flex: 1 },
  zoneName: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: Colors.textPrimary },
  zoneNameMr: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary },
  alertBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: BorderRadius.full },
  alertBadgeText: { color: Colors.white, fontSize: 10, fontFamily: 'Poppins_600SemiBold' },
  statusRow: { flexDirection: 'row', gap: Spacing.md, paddingTop: Spacing.xs, borderTopWidth: 1, borderTopColor: Colors.border },
  statusItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusItemText: { fontSize: 12, fontFamily: 'Poppins_500Medium', color: Colors.textSecondary },
  wardsSection: { marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border },
  wardsTitle: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: Colors.textSecondary, marginBottom: 6 },
  wardsList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  wardChip: { borderWidth: 1, borderRadius: BorderRadius.full, paddingHorizontal: 10, paddingVertical: 3 },
  wardChipText: { fontSize: 11, fontFamily: 'Poppins_500Medium' },
  workerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  workerRowName: { flex: 1, fontSize: 13, fontFamily: 'Poppins_400Regular', color: Colors.textPrimary },
  workerStatusDot: { width: 8, height: 8, borderRadius: 4 },
  workerStatusText: { fontSize: 12, fontFamily: 'Poppins_500Medium' },
});