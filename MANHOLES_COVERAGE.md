# 🗺️ SMC-LiveMonitor: 100-Manhole Coverage Map

## Overview
Comprehensive sewer line monitoring coverage across Solapur with **100 manholes** distributed across 5 geographical zones.

---

## Zone Distribution

### 🔵 North Zone (MH-01 to MH-20)
**20 manholes** covering:
- Hotgi Road Junction, Bale Nagar Colony, Kamgar Putala
- MIDC Industrial Area, Navi Peth, Deshpande Nagar
- Railway Staff Colony, Government Hospital Area
- Kasturba Nagar, Shelgi Phata, Jyoti Colony
- Lokmanya Nagar, Ambedkar Chowk North

### 🟢 South Zone (MH-21 to MH-40)
**20 manholes** covering:
- Akkalkot Road, Vijapur Road, Murarji Peth
- Budhwar Peth South, Sakhar Peth, Sidheshwar Temple
- Railway Station South, Soregaon Phata, Shukrawar Peth
- Ramling Temple, Janata Market, Siddheshwar College
- Solapur University, Krantiveer Chowk, Bhavani Peth

### 🟠 East Zone (MH-41 to MH-60)
**20 manholes** covering:
- Hutatma Chowk, Osmanabad Naka, Ashok Chowk
- Railway Station East Gate, Barshi Road, Hotgi Railway Crossing
- Market Yard East, APMC Main Gate, Jath Road Circle
- Ramkrishna Nagar, New Paccha Peth East, Industrial Estate
- Bawachi Math, Railway Goods Yard, City Bus Stand East

### 🟣 West Zone (MH-61 to MH-80)
**20 manholes** covering:
- Pandharpur Road, Bijapur Road, Jule Solapur
- Shelagi Phata West, Kurduwadi Road, Bhagwat Hospital West
- Railway Overbridge West, Industrial Area West Gate
- Kambar Talav, Tuljapur Road, Civil Hospital West
- Saraswati Nagar, Degaon Phata, Modi Hospital Road
- Rajiv Gandhi Nagar, Agriculture College, Maulana Azad Chowk

### 🔴 Central Zone (MH-81 to MH-100)
**20 manholes** covering:
- Mangalwar Peth, Budhwar Peth, Sadar Bazar
- Raviwar Peth, Shaniwar Peth, Guruwar Peth
- SMC Head Office, District Collector Office, Central Bus Stand
- City Police Station, Gandhi Market, Maldhakka Chowk
- Jodbhavi Math, Town Hall, Subhash Chowk
- Zilla Parishad, Main Post Office, City Court, Commercial Complex

---

## GPS Coordinate Ranges

| Zone | Latitude Range | Longitude Range |
|------|---------------|----------------|
| **North** | 17.6980 - 17.7065 | 75.9070 - 75.9140 |
| **South** | 17.6760 - 17.6818 | 75.9018 - 75.9070 |
| **East** | 17.6850 - 17.6895 | 75.9120 - 75.9170 |
| **West** | 17.6900 - 17.6945 | 75.8965 - 75.9010 |
| **Central** | 17.6865 - 17.6900 | 75.9050 - 75.9088 |

---

## Implementation Details

### Files Modified

1. **services/sensorService.ts**
   - Expanded `SOLAPUR_MANHOLES` array from 10 to 100 entries
   - Maintained proper TypeScript types
   - All coordinates within Solapur municipal bounds

2. **scripts/seedFirebase.js**
   - Updated worker assignments to use new manholes
   - w001 → MH-12 (Deshpande Nagar Square, North)
   - w002 → MH-48 (Jath Road Circle, East)
   - w003 → MH-27 (Railway Station South Gate, South)
   - w004 → MH-68 (Industrial Area West Gate, West)
   - w005 → MH-89 (Central Bus Stand, Central)
   - Updated alert references to new manholes

### Data Structure
Each manhole includes:
```typescript
{
  id: 'MH-XXX',           // MH-01 to MH-100
  zone: string,            // north/south/east/west/central
  label: string,           // Human-readable location
  lat: number,             // GPS latitude
  lng: number              // GPS longitude
}
```

---

## Testing & Verification

✅ **Total Manholes**: 100  
✅ **Unique IDs**: MH-01 through MH-100  
✅ **Zone Distribution**: 20 manholes per zone  
✅ **GPS Validation**: All coordinates within Solapur bounds (17.65-17.72 lat, 75.89-75.93 lng)  
✅ **TypeScript Types**: All type definitions maintained  
✅ **Seed Data**: Workers assigned to new manholes  
✅ **Zone Dashboard**: Ready to display all 100 locations  

---

## Usage

### In the App
1. Navigate to **Zones** tab in the dashboard
2. View interactive map with all 100 manholes color-coded by zone
3. Select any zone to see its 20 manholes
4. Click on workers to see their current manhole assignment
5. Filter alerts by zone to see location-specific incidents

### For Arduino/ESP32 Devices
When workers move between locations, update their manhole assignment:

```cpp
// Example: Worker moving to new manhole
Firebase.RTDB.setString(&fbdo, "/workers/w001/manhole_id", "MH-45");
Firebase.RTDB.setString(&fbdo, "/workers/w001/location_label", "Sakhar Peth East Entry");
Firebase.RTDB.setFloat(&fbdo, "/workers/w001/gps_lat", 17.6875);
Firebase.RTDB.setFloat(&fbdo, "/workers/w001/gps_lng", 75.9160);
```

### For Managers
- Monitor coverage across all 100 locations
- Track which manholes need inspection
- Assign workers to specific manholes
- Generate zone-specific reports

---

## Next Steps (Optional Enhancements)

1. **Add Manhole Status Tracking**
   - Last inspection date
   - Maintenance history
   - Priority level (high-risk areas)

2. **Geofencing Alerts**
   - Alert when worker leaves assigned zone
   - Alert when worker is too far from assigned manhole

3. **Route Optimization**
   - Suggest optimal manhole inspection sequence
   - Calculate distance between manholes

4. **Manhole-Specific Data**
   - Depth measurements
   - Flow rate sensors
   - Blockage detection history

5. **Heatmap Visualization**
   - Show incident frequency per manhole
   - Highlight high-risk areas

---

## Support
Built for **Solapur Municipal Corporation**  
Sanitation Worker Safety Initiative 2025  

For technical support, contact: SMC IT Department
