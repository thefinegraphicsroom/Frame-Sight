# FrameSight – User Guide

## Overview

FrameSight is a desktop application designed for real-time OCR (text recognition) and overlay data extraction from live screen content (such as game broadcasts).

This version is fully packaged as a Windows application. No additional installations (Node.js, libraries, etc.) are required.

---

## System Requirements

* OS: Windows 10 / Windows 11 (64-bit)
* RAM: Minimum 4 GB (8 GB recommended)
* Internet: Required (for initial resource loading)
* GPU: Optional but recommended for smoother performance

---

## Installation

1. Run the file:

   ```
   FrameSight Setup.exe
   ```

2. Follow the installer steps:

   * Click **Next**
   * Choose installation location (optional)
   * Click **Install**

3. Once installed:

   * Launch **FrameSight** from Desktop or Start Menu

---

## First Launch

When you open the app, you will see the main interface with multiple tabs:

* Settings
* Capture
* Live
* Debug (optional)

---

## How to Use

### 1. Select Capture Source

* Go to **Capture tab**
* Click **Select Window / Screen**
* Choose:

  * Full screen OR
  * Specific application window

---

### 2. Start Capture

* Click **Start Capture**
* You should now see a live preview

---

### 3. Create Detection Areas

* Draw boxes on the screen where text appears
* Assign names (e.g., Player1, Score, Timer)

---

### 4. Start Engine

* Click **Run Engine**
* The app will:

  * Continuously scan selected areas
  * Extract text using OCR
  * Update live data

---

### 5. Access Output Data

The app generates live data in two ways:

#### A. Local Output Files

* JSON file (structured data)
* TXT files (individual values)

#### B. Local Server Endpoint

* Example:

  ```
  http://YOUR-IP:PORT/ProfileName.json
  ```

You can use this in:

* OBS overlays
* Web dashboards
* Broadcast tools

---

## Features

* Real-time OCR processing
* Screen/window capture
* Custom detection regions
* Live JSON output
* Local HTTP server for integration
* Profile-based configurations

---

## Notes

* Accuracy depends on screen clarity and font size
* OCR may take a few seconds to initialize on first run
* Keep the app window visible for best performance

---

## Troubleshooting

### App does not start

* Ensure Windows Defender is not blocking it
* Run as Administrator (if needed)

---

### OCR not detecting text

* Make sure:

  * Text is clearly visible
  * Area selection is correct
  * Capture is running

---

### Capture not working

* Re-select the window/screen
* Restart the application

---

### Blank or missing UI elements

* Ensure internet connection is active

---

## Updating the Application

To update:

1. Uninstall the old version
2. Install the new `.exe`

(Automatic updates are not included in this version)

---

## Uninstall

* Go to:

  ```
  Control Panel → Programs → Uninstall a Program
  ```
* Select **FrameSight**
* Click **Uninstall**

---

## Support

If you encounter issues, contact the provider who shared this application.

---

## Version

Version: 1.0.0
Application: FrameSight

---

## Disclaimer

This application is provided as-is. Performance may vary depending on system configuration and usage conditions.
