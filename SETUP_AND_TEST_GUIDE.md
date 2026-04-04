# Quick Setup & Test Guide

## 🚀 Quick Start

### 1. Install New Dependency
```bash
npm install
# This will install expo-av which is needed for alarm.mp3 playback
```

### 2. Restart Development Server
```bash
npx expo start --clear
```

### 3. Open App
- **Mobile**: Scan QR code with Expo Go
- **Web**: Press `w` in terminal

---

## 🧪 Test Scenarios

### Test 1: Alarm Sound Plays ✅

**Steps:**
1. Open the app
2. Wait for or trigger an emergency alert (SOS/FALL)
3. Listen for alarm sound

**Expected:**
- ✅ alarm.mp3 sound plays
- ✅ Phone vibrates (mobile only, critical alerts)
- ✅ Red emergency popup appears
- ✅ No console errors

---

### Test 2: Mark Resolved Works ✅

**Steps:**
1. Navigate to Alerts tab
2. Find an unresolved alert
3. Click "Mark Resolved" button
4. Confirm in the dialog

**Expected:**
- ✅ Confirmation dialog appears
- ✅ After confirming, alert becomes semi-transparent
- ✅ Shows green checkmark with "Resolved by [Your Name]"
- ✅ "Mark Resolved" button disappears
- ✅ Alert counter decreases

---

### Test 3: Full Emergency Flow ✅

**Steps:**
1. Start at Overview tab
2. Trigger emergency (or wait for test alert)
3. Observe alarm sound and popup
4. Click "Acknowledge & Go to Alerts"
5. Alerts tab opens
6. Click "Mark Resolved" on the alert
7. Go back to Overview

**Expected:**
- ✅ Sound plays when alert triggers
- ✅ Popup appears
- ✅ Clicking acknowledge closes popup
- ✅ Navigate to Alerts tab
- ✅ Alert can be resolved
- ✅ Unresolved count decreases

---

## 🔧 If Something Doesn't Work

### Sound not playing?
```bash
# Clear cache and restart
npx expo start --clear

# Check if expo-av installed
npm list expo-av
# Should show: expo-av@15.0.8 or similar

# If not installed
npx expo install expo-av
```

### Web sound issues?
1. Check browser console (F12)
2. Make sure `/alarm.mp3` is accessible
3. Try clicking something first (browsers block autoplay until user interaction)
4. Check browser volume settings

### Mark Resolved not working?
1. Check if you're logged in
2. Verify Firebase connection
3. Check console for errors
4. Try restarting the app

---

## ✅ Success Checklist

After setup, verify:

- [ ] `npm install` completed without errors
- [ ] expo-av appears in package.json dependencies
- [ ] App starts without errors
- [ ] alarm.mp3 plays when alert triggers
- [ ] "Mark Resolved" button appears on unresolved alerts
- [ ] Clicking "Mark Resolved" shows confirmation dialog
- [ ] After confirming, alert shows as resolved
- [ ] Resolved alerts show "Resolved by [Name]"
- [ ] No errors in console

---

## 📱 Platform-Specific Notes

### Mobile (iOS/Android)
- ✅ Uses expo-av for sound playback
- ✅ Vibration works for critical alerts
- ✅ Sound plays even in silent mode (iOS)
- ✅ Proper audio ducking on Android

### Web (Browser)
- ✅ Uses HTML5 Audio API
- ⚠️ May need user interaction first (browser autoplay policy)
- ✅ Falls back to tone if file doesn't load
- ✅ Works in Chrome, Firefox, Safari, Edge

---

## 🎵 Sound Files

**Location**: `alarm.mp3` in project root

**Properties**:
- Format: MP3
- Used for: All emergency alerts
- Volume: 100% (adjustable in code if needed)
- Looping: No (plays once)

**When it plays**:
- SOS alerts
- Fall detection
- Critical gas levels
- Critical health readings

---

## 📊 Testing Data

To test, you can use the seed script to create test alerts:

```bash
node scripts/seedFirebase.js
```

This creates:
- 5 workers across all zones
- Sample emergency alerts
- Test sensor data

---

## 🐛 Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| "expo-av not found" | Run `npx expo install expo-av` |
| Sound doesn't play | Check volume, check console for errors |
| "Mark Resolved" missing | Only shows on unresolved alerts |
| Changes not reflecting | Run `npx expo start --clear` |
| Web sound blocked | Click anywhere in app first, then trigger alert |

---

## 💡 Tips

1. **Test on real device**: Sound/vibration work best on physical phones
2. **Check volume**: Make sure phone/computer volume is up
3. **Silent mode**: iOS will still play sound if configured correctly
4. **Browser autoplay**: Click something before expecting sound on web
5. **Real-time updates**: Alerts update automatically via Firebase listeners

---

## 📞 Need Help?

1. Check console for error messages
2. Verify all files are saved
3. Clear cache: `npx expo start --clear`
4. Reinstall dependencies: `rm -rf node_modules && npm install`
5. Check Firebase connection

---

## 🎉 You're All Set!

The app now:
- ✅ Plays alarm.mp3 for emergency alerts
- ✅ Allows marking alerts as resolved
- ✅ Shows resolved status with manager name
- ✅ Works on mobile and web
- ✅ Has proper error handling
