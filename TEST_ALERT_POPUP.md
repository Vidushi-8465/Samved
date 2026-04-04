# Quick Test Guide - Emergency Alert Popup Fix

## How to Test the Fix

### Setup
1. Make sure you have the latest code changes
2. Run the seed script if needed: `node scripts/seedFirebase.js`
3. Start the app: `npx expo start`

### Test Scenario 1: Emergency Alert Popup Appears
**Steps:**
1. Open the app and navigate to Overview/Dashboard
2. Wait for or trigger an emergency alert (SOS or FALL)
   - The red emergency popup should appear with pulsing animation
   - Shows "EMERGENCY ALERT" title
   - Lists affected workers

**Expected Result:** ✅ Popup appears correctly

### Test Scenario 2: Acknowledge and Navigate (MAIN FIX)
**Steps:**
1. When the red emergency popup is visible
2. Click the "Acknowledge & Go to Alerts" button

**Expected Results:**
- ✅ Popup closes immediately
- ✅ App navigates to the Alerts tab
- ✅ Alerts section is now visible showing all alerts
- ✅ No delay or flickering

**Test on Both:**
- 📱 Mobile (Phone/Emulator)
- 💻 Web (Browser)

### Test Scenario 3: Popup Can Be Reopened
**Steps:**
1. After dismissing the popup (from Scenario 2)
2. Navigate back to Overview tab
3. Look for the red banner at the top: "X UNRESOLVED ALERTS — TAP TO VIEW"
4. Tap/Click the banner

**Expected Result:** ✅ Popup appears again

### Test Scenario 4: Multiple Alerts
**Steps:**
1. If you have multiple SOS/FALL alerts
2. Open the emergency popup
3. Click "Acknowledge & Go to Alerts"

**Expected Results:**
- ✅ Popup shows all emergency alerts
- ✅ Closes properly when acknowledged
- ✅ Navigates to Alerts tab showing all alerts

### Test Scenario 5: Auto-Hide When Resolved
**Steps:**
1. Open the emergency popup
2. In another window/device, resolve all emergency alerts
3. The popup should automatically disappear

**Expected Result:** ✅ Popup auto-hides when no more active emergencies

## What Was Fixed

### Before ❌
- Clicking "Acknowledge & Go to Alerts" didn't close the popup
- Modal stayed visible even after state change
- Navigation might work but popup remained

### After ✅
- Clicking "Acknowledge & Go to Alerts" closes popup immediately
- Modal respects the `showSOS` state
- Navigation happens smoothly
- Works on both mobile and web

## Technical Changes
- Added `visible` prop to `SOSModal` component
- Updated visibility logic: `if (active.length === 0 || !visible)`
- Passing `showSOS` state to control modal visibility

## Troubleshooting

### Popup doesn't appear
- Check if there are active SOS/FALL alerts in Firebase
- Check browser console for errors
- Verify seed script ran successfully

### Navigation doesn't work
- Verify expo-router is working: `npx expo start --clear`
- Check that `(dashboard)/alerts.tsx` file exists
- Look for navigation errors in console

### Popup appears but doesn't close
- Clear app cache: `npx expo start --clear`
- Check that changes to `overview.tsx` were saved
- Restart the metro bundler

## Files to Check
- ✅ `app/(dashboard)/overview.tsx` - Main fix
- ✅ `app/(dashboard)/alerts.tsx` - Navigation target
- ✅ `app/(dashboard)/_layout.tsx` - Tab configuration

## Success Criteria
✅ All 5 test scenarios pass
✅ Works on mobile (iOS/Android)
✅ Works on web
✅ No console errors
✅ Smooth user experience
