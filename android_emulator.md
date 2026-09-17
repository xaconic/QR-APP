### STEP 1 — Open PowerShell

You can use a fresh PowerShell window.

Run:

```
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path += ";$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator"
```

This makes `adb` and `emulator` available in that PowerShell session. Your previous setup successfully recognized `adb` from the Android SDK.

---

### STEP 2 — Start ADB

Run:

```
adb start-server
```

You should see something like:

```
* daemon not running; starting now at tcp:5037
* daemon started successfully
```

If it says the daemon is already running, **that's also fine**.

---

### STEP 3 — Check your available emulator

Run:

```
emulator -list-avds
```

You currently have:

```
Pixel_6
```

This was confirmed in your setup.

---

### STEP 4 — Start the emulator

Run:

```
emulator -avd Pixel_6
```

**Do not close this PowerShell window.**

Wait for the Android emulator window to appear and completely finish booting.

Your previous emulator successfully reached:

```
INFO | Boot completed in 24401 ms
```

so this part is working.

---

## STEP 5 — Open a SECOND PowerShell window

This is important.

Leave the emulator-running PowerShell window alone.

Open another PowerShell window.

Run:

```
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path += ";$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator"
```

Then:

```
adb devices -l
```

### You want to see:

```
List of devices attached
emulator-5554    device
```

For example:

```
emulator-5554          device product:sdk_gphone16k_x86_64 model:sdk_gphone16k_x86_64 device:emu64xa16k transport_id:1
```

### ⚠️ If you see:

```
emulator-5554    offline
```

**DO NOT start Expo yet.**

Wait a little and run:

```
adb devices
```

again.

You previously had exactly this `offline` situation.

Only continue when it says:

```
device
```

---

# STEP 6 — NOW start Expo

Once this:

```
adb devices
```

shows:

```
emulator-5554    device
```

go to your Expo project.

For your QR app, run:

```
cd "C:\Users\James Ivan\Desktop\QR-APP"
```

Then start Expo:

```
npx expo start
```

---

# STEP 7 — Open the app on Android

Once Expo starts, you should see something similar to:

```
› Metro waiting on exp://...
› Press a │ open Android
› Press w │ open web
```

Press:

```
a
```

Expo should detect the running Android emulator and launch the app there.

You **do not need a physical Android phone** for this.

---

# ⭐ Your simple routine

Every time you want to work on the QR app:

### PowerShell #1 — Emulator

```
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path += ";$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator"

adb start-server

emulator -avd Pixel_6
```

**Leave this window running.**

### PowerShell #2 — Expo

```
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path += ";$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator"

adb devices
```

Make sure:

```
emulator-5554    device
```

Then:

```
cd "C:\Users\James Ivan\Desktop\QR-APP"
npx expo start
```

Then press:

```
a
```

---

## 🚨 One important thing

You **do NOT need to run this every time**:

```
adb kill-server
```

And you don't need to repeatedly use:

```
taskkill /F /IM emulator.exe
taskkill /F /IM adb.exe
```

Those are **troubleshooting commands**, mainly for when the emulator/ADB gets stuck or shows `offline`.

### Normal startup =

**Set Android variables → start emulator → verify `device` → start Expo.**

That's the workflow I recommend for your QR Attendance app.
