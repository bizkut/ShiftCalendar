# ShiftCalendar

A shift scheduling app for shift workers, built with React Native + Expo. Use local-only calendars on a device or the Access-protected Cloudflare pilot for private and team calendars. Cloud saves require connectivity.

[![Download APK](https://img.shields.io/github/v/release/iTroy0/ShiftCalendar?label=Download%20APK&style=for-the-badge)](https://github.com/iTroy0/ShiftCalendar/releases/latest)

## Features

- **Monthly Calendar** -- Color-coded shift & leave badges with swipe navigation
- **Adjacent Month Days** -- See previous/next month shifts in the calendar grid
- **Quick Assign** -- Tap to assign, long-press for instant last-used shift
- **Shift Templates** -- 9 pre-built rotations (2-2-2, 2-2-4, 4-on/4-off, Continental, Panama, DuPont, and more)
- **Repeat Patterns** -- Select a date range and repeat any shift pattern forward
- **Custom Shifts** -- Create shift types with custom names, colors, icons, and times
- **Leave Management** -- Annual, Sick, Emergency, and Unpaid leave with yearly balance tracking
- **Shift Swap** -- Offer swaps and share requests via WhatsApp, SMS, etc.
- **Pay Calculator** -- Base rate + overtime rate with monthly pay estimates
- **Multi-Calendar** -- Manage separate calendars (e.g. My Shifts, Team A, Team B)
- **Stats Dashboard** -- Monthly shift counts, hours breakdown, pay estimates, and leave balance
- **Overtime Tracking** -- Log overtime hours per day with automatic totals
- **Notes & Search** -- Add notes to any day and search through all notes
- **Android Widget** -- Home screen widget showing the current week's shifts
- **Week View** -- Toggle between month and week views
- **Yearly Overview** -- At-a-glance heatmap of the entire year
- **Dark / Light / System Theme** -- Full theme support including the widget
- **Export & Import** -- CSV export/import, PDF export, full backup/restore
- **Notifications** -- Evening reminders for the next day's shift
- **Configurable** -- Week start day, currency (33 supported), haptic feedback
- **Local-only mode** -- Keep calendars on the device without a login. Native local-only behavior remains independent of the Cloudflare browser pilot.
- **Accessible** -- Screen reader labels on all interactive elements

## Cloudflare hosting and teams

The target uses Workers Static Assets for the website, a Worker for the API,
D1 for calendars and team roles, and Cloudflare Access for approved-email login.
Use `https://shifts.amazonian.my`; the former workers.dev address is disabled.
The domain is reachable; the historical two-user M2c login, private persistence and cross-user denial checks passed.
A tested RS256 write path is deployed. M2c passed its cold/warm CPU, persistence and privacy checks. Production is currently restricted to one active Access identity, `bizkut.limau@gmail.com`. The deployed M3 candidate adds application administration, targeted invitations, team switching, roles and team calendars, but multi-user rollout and final live acceptance are deferred. Team leaders and managers edit team calendars; members and viewers are read-only.
The Free Access pilot is limited to 50 users, and Free quotas apply to hosting.

See [the phased plan](AWS_HOSTING_PLAN.md) for service mapping, limits and migration milestones.
The single-user Cloudflare pilot is deployed. M2c is verified; M3's implementation is deployed and its multi-user acceptance is deferred. Full multi-member roster views remain M4. See [the Cloudflare runbook](CLOUDFLARE.md) for setup
and validation. The attempted AWS deployment was
blocked and cleaned up; [the AWS runbook](DEPLOYMENT.md) is historical reference.

The browser supports CSV and JSON file flows and PDF through the browser print
dialog. Android widgets and native reminders remain device features. Local JSON
backups exclude sessions and cloud caches; they are not database backups.

## Screenshots

<p align="center">
  <img src="screenshots/calendar.png" width="250" alt="Calendar" />
  <img src="screenshots/stats.png" width="250" alt="Stats" />
  <img src="screenshots/settings.png" width="250" alt="Settings" />
</p>

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (Node 24 LTS recommended)
- [Expo CLI](https://docs.expo.dev/get-started/installation/)

### Installation

```bash
git clone https://github.com/iTroy0/ShiftCalendar.git
cd ShiftCalendar
npm install
```

### Development

```bash
npx expo start
npx expo start --android
npx expo start --ios
```

> **Note:** The Android home screen widget requires an EAS development build, not Expo Go.

## Building

### Cloud Build (EAS)

```bash
npm install -g eas-cli
eas login

# Preview APK
eas build --platform android --profile preview

# Production AAB (for Google Play)
eas build --platform android --profile production
```

### Local Build

```bash
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

## Project Structure

```
ShiftCalendar/
├── app/
│   ├── _layout.tsx              # Root layout with providers
│   └── (tabs)/
│       ├── index.tsx             # Calendar screen
│       ├── stats.tsx             # Stats screen
│       └── settings.tsx          # Settings screen
├── components/
│   ├── CalendarDay.tsx           # Day cell with shift/leave pills
│   ├── DaySheet.tsx              # Day detail bottom sheet
│   ├── TemplateSheet.tsx         # Template selector
│   ├── RepeatSheet.tsx           # Pattern repeat sheet
│   ├── NotesSearchSheet.tsx      # Notes search
│   ├── ShiftEditor.tsx           # Shift create/edit form
│   ├── WeekView.tsx              # Week view display
│   ├── YearlyOverview.tsx        # Yearly heatmap
│   └── settings/                 # Settings section components
├── hooks/
│   ├── ShiftContext.tsx           # Shift data context
│   ├── ThemeContext.tsx           # App settings context
│   ├── useShiftData.ts           # Data persistence layer
│   ├── useTheme.ts               # Theme & preferences
│   └── useDeepLinkHandler.ts     # File import handler
├── constants/
│   ├── shifts.ts                 # Shift type definitions
│   ├── templates.ts              # Rotation templates
│   ├── leaveTypes.ts             # Leave type definitions
│   ├── colors.ts                 # Theme color palettes
│   └── currencies.ts             # Currency list
├── utils/
│   ├── exportImport.ts           # CSV/PDF/backup export & import
│   ├── statsCalculation.ts       # Stats computation
│   └── notifications.ts          # Shift reminders
├── widgets/
│   ├── ShiftWeekWidget.tsx       # Android widget UI
│   └── widget-task-handler.tsx   # Widget data handler
└── assets/                       # App icons & splash
```

## Tech Stack

- **Framework** -- React Native + Expo SDK 55
- **Language** -- TypeScript
- **Routing** -- Expo Router (file-based)
- **Calendar** -- react-native-calendars
- **Animations** -- react-native-reanimated
- **Gestures** -- react-native-gesture-handler
- **Bottom Sheets** -- @gorhom/bottom-sheet
- **Storage** -- @react-native-async-storage/async-storage
- **Widget** -- react-native-android-widget
- **Date Math** -- date-fns
- **Haptics** -- expo-haptics

## License

MIT

## Author

Made by **Troy**

Cloudflare pilot: https://shifts.amazonian.my (Access-protected,
one active approved email). Private persistence and isolation are verified; the M3 team implementation remains deployed with multi-user acceptance deferred. See [live evidence and remaining checks](CLOUDFLARE.md).
