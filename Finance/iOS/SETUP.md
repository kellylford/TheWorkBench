# Portfolio Accessibility Demo - Setup Instructions

This app demonstrates accessible data tables and VoiceOver navigation in iOS SwiftUI.

## Requirements
- Xcode 15.0+
- iOS 15.0+ deployment target
- Free Finnhub API key

## Setup Steps

### 1. Get a Finnhub API Key
1. Visit [https://finnhub.io](https://finnhub.io)
2. Sign up for a free account
3. Copy your API key from the dashboard

### 2. Configure the API Key
1. Navigate to `Finance/iOS/Portfolio/Services/`
2. Copy the example config file:
   ```bash
   cp Config.swift.example Config.swift
   ```
3. Open `Config.swift` and replace `YOUR_FINNHUB_API_KEY_HERE` with your actual API key
4. The `Config.swift` file is gitignored and will stay local to your machine

### 3. Generate the Xcode Project
```bash
cd Finance/iOS
xcodegen generate
```

### 4. Open and Build
```bash
open "Portfolio Accessibility Demo.xcodeproj"
```

Build and run on simulator or device.

## Features Demonstrated

### VoiceOver Accessibility
- **Data Table Navigation**: Proper UIAccessibilityContainerDataTable implementation
- **Row/Column Navigation**: Navigate by row or column headers with VoiceOver
- **Custom Actions**: Move rows up/down/to top/to bottom via VoiceOver rotor Actions menu

### Long-Press Context Menu
- Press and hold any portfolio row to see move actions
- Works for sighted users without VoiceOver

### Live Stock Data
- Real-time quotes from Finnhub API
- Default holdings: MSFT, GOOG, QQQ, SPY, LITE (10 shares each)
- Pull to refresh updates all holdings

## Troubleshooting

**"data couldn't be retrieved"**
- Check your API key is correctly set in `Config.swift`
- Verify internet connection
- Finnhub free tier: 60 API calls/minute limit

**Build errors about Config**
- Make sure you created `Config.swift` from the example file
- Verify it's in `Portfolio/Services/` folder

**VoiceOver navigation issues**
- Enable VoiceOver: Settings → Accessibility → VoiceOver
- Use rotor to access "Actions" category for row movement
- Swipe up/down with one finger to select actions

## Project Structure

```
Finance/iOS/
├── Portfolio/
│   ├── PortfolioApp.swift
│   ├── Models/
│   │   └── Models.swift
│   ├── Services/
│   │   ├── Config.swift (local only)
│   │   └── FinnhubService.swift
│   ├── Views/
│   │   ├── ContentView.swift
│   │   ├── AddTickerSheet.swift
│   │   └── EditHoldingSheet.swift
│   └── Utilities/
│       ├── PortfolioViewModel.swift
│       └── AccessibleTableBridge.swift
├── PortfolioTests/
├── PortfolioUITests/
└── project.yml (XcodeGen config)
```

## Accessibility Documentation

See [ACCESSIBLE_TABLES_IOS.md](ACCESSIBLE_TABLES_IOS.md) for detailed information about the table accessibility implementation.
