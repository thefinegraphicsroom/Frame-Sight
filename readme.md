# FrameSight – User Guide

## Overview

FrameSight is a desktop application for real-time OCR (text recognition) and data extraction from live screen content such as games, broadcasts, or video feeds.

This version is fully packaged as a Windows application. No additional software or libraries are required.

---

## System Requirements

* OS: Windows 10 / Windows 11 (64-bit)
* RAM: Minimum 4 GB (8 GB recommended)
* Internet: Required (for UI resources)
* Display: 1080p or higher recommended

---

## Installation

1. Run:

   ```
   FrameSight Setup.exe
   ```
2. Follow installation steps
3. Launch from Desktop or Start Menu

---

## Application Structure (Categories)

FrameSight is organized into functional sections:

### 1. Settings

* Profile name configuration
* Team names and keys
* General app setup

---

### 2. Capture

* Select screen or window
* Live preview display
* Draw detection areas (OCR zones)

---

### 3. Live

* Displays extracted data in real time
* Shows JSON output structure

---

### 4. Info

* Network endpoint (IP + Port)
* Output status
* Connection details for integrations

---

### 5. Debug (Advanced)

* Layer inspection
* OCR diagnostics
* Performance monitoring

---

## How It Works (Core Workflow)

FrameSight follows a structured pipeline:

### Step 1: Screen Capture

* You select a screen or application window
* FrameSight continuously captures frames

---

### Step 2: Region Selection (Layers)

* You draw boxes over areas containing text
* Each box = a "layer" (e.g., score, player name)

---

### Step 3: OCR Processing

* The app scans each layer
* Extracts text using OCR engine
* Updates values continuously

---

### Step 4: Data Structuring

* Extracted data is stored in structured format:

  * JSON object
  * Key-value pairs

---

### Step 5: Output Delivery

FrameSight outputs data in two ways:

#### A. Local Files

* `.json` file (full dataset)
* `.txt` files (individual values)

#### B. Local Server

Example:

```
http://YOUR-IP:PORT/ProfileName.json
```

This can be used in:

* OBS overlays
* Streaming tools
* Web dashboards

---

## How to Use

### 1. Select Source

* Go to **Capture**
* Click **Select Window / Screen**
* Choose your source

---

### 2. Start Capture

* Click **Start Capture**
* Preview appears

---

### 3. Create Layers

* Draw boxes over text areas
* Assign names (e.g., Player1, KillCount)

---

### 4. Run Engine

* Click **Run Engine**
* OCR starts processing

---

### 5. Monitor Output

* Check **Live tab**
* Or open the server URL

---

## Profiles (Import / Export)

Profiles allow you to save and reuse configurations.

---

### Export Profile

Use this when you want to save your setup:

1. Go to **Settings**
2. Click **Save Profile**
3. Choose a location
4. A `.json` file will be created

This file contains:

* Layer positions
* Names and keys
* Configuration settings

---

### Import Profile

Use this to load an existing setup:

1. Go to **Settings**
2. Click **Load Profile**
3. Select the `.json` file

The app will:

* Restore all layers
* Apply saved configuration
* Load instantly without manual setup

---

### Use Case Example

* Create profile for Game A
* Export it
* Share with teammates
* They import and use instantly

---

## Features

* Real-time OCR scanning
* Multi-layer detection system
* Custom naming and structuring
* Live JSON output
* Built-in HTTP server
* Profile save/load system
* Designed for broadcast workflows

---

## Important Notes

* OCR accuracy depends on:

  * Text clarity
  * Resolution
  * Contrast
* Keep capture area stable
* Avoid overlapping layers

---

## Troubleshooting

### OCR not working

* Ensure text is clearly visible
* Re-adjust layer size
* Restart engine

---

### Capture not starting

* Re-select source
* Restart application

---

### No data output

* Ensure engine is running
* Check Live tab
* Verify server URL

---

### UI issues

* Ensure internet connection is active

---

## Updating the Application

To update:

1. Uninstall current version
2. Install new version using `.exe`

---

## Uninstall

* Open:

  ```
  Control Panel → Programs
  ```
* Select **FrameSight**
* Click **Uninstall**

---

## Version

Version: 1.0.0
Application: FrameSight

---

## Disclaimer

This software is provided as-is. Performance may vary depending on system configuration and usage conditions.
