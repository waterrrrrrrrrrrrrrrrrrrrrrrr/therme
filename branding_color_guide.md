# Branding Color System Guide

## Overview

Thermio uses a flexible branding system that allows workspaces to customize their appearance while maintaining professional consistency and accessibility.

---

## Current Color Configuration

### Workspace Branding Settings

Located in **Workspace Settings → Branding**, workspaces can customize:

1. **Primary Color** (Default: `#3b82f6` - Blue)
   - Used for: Main UI elements, buttons, active states, links
   - Applied to: CTA buttons, navigation highlights, focus states

2. **Accent Color** (Default: `#facc15` - Yellow)
   - Used for: Secondary highlights, warnings, decorative elements
   - Applied to: Gradient balls, badges, secondary buttons

3. **Profile Avatar Color** (Default: `#3b82f6` - Blue)
   - Used for: Profile circle border in header
   - Applied to: User avatar ring

4. **Favicon / Logo**
   - Custom workspace branding icon
   - Appears in browser tab and login page

5. **Login Background Image**
   - Custom background for workspace login
   - Falls back to gradient ball animation if not set

---

## Recommended Color System Architecture

### **1. Primary Brand Colors**

#### Primary Color
- **Purpose**: Main brand identity, primary actions
- **Usage**: Primary buttons, links, active navigation, focus states
- **Recommendations**:
  - Use high contrast against white/black backgrounds
  - Test for accessibility (WCAG AA minimum: 4.5:1 contrast ratio)
  - Consider brand recognition and emotional response

**Examples:**
- **Corporate/Professional**: `#2563eb` (Deep Blue), `#059669` (Forest Green)
- **Modern/Tech**: `#3b82f6` (Bright Blue), `#8b5cf6` (Purple)
- **Food/Hospitality**: `#dc2626` (Red), `#f97316` (Orange)
- **Medical/Clean**: `#06b6d4` (Cyan), `#10b981` (Emerald)

#### Accent Color
- **Purpose**: Secondary highlights, visual interest
- **Usage**: Decorative elements, hover states, secondary badges
- **Recommendations**:
  - Should complement (not compete with) primary color
  - Can be brighter/more saturated
  - Used sparingly for impact

**Complementary Pairs:**
- Blue Primary → Yellow/Orange Accent
- Green Primary → Yellow/Cyan Accent
- Purple Primary → Yellow/Pink Accent
- Red Primary → Yellow/Teal Accent

---

### **2. UI Background Colors** (System-Managed)

These are currently hardcoded but could be configurable:

```css
--bg: #0f1117          /* Main background (dark mode) */
--bg2: #1a1d27         /* Card backgrounds */
--bg3: #21262d         /* Elevated surfaces */
--bg-input: #1c1f26    /* Form inputs */
--border: #2a2d3a      /* Subtle borders */
--border2: #2d3748     /* Stronger borders */
```

**Recommendation:** Keep these system-managed for consistency, OR allow "Theme Mode" toggle:
- **Dark Theme** (current): Dark backgrounds with light text
- **Light Theme** (future): Light backgrounds with dark text

---

### **3. Semantic Status Colors** (System-Managed)

Fixed colors with specific meanings:

```css
--green: #22c55e      /* Success, active, live */
--red: #ef4444        /* Error, danger, overdue */
--yellow: #f59e0b     /* Warning, pending, soon */
--blue: #3b82f6       /* Info, default */
--blue-light: #60a5fa /* Hover states, links */
```

**Recommendation:** Do NOT allow workspace customization of these colors as they carry universal meaning:
- ✅ Green = Active/Good
- 🔴 Red = Critical/Error
- ⚠️ Yellow = Warning/Attention

---

### **4. Text Colors** (System-Managed)

```css
--text: #e6edf3           /* Primary text */
--text-muted: #8b949e     /* Secondary text */
--text-dim: #6b7280       /* Tertiary text */
```

**Recommendation:** Auto-calculate based on background for accessibility:
- Dark background → Light text
- Light background → Dark text

---

## Color Palette Templates

### **Template 1: Corporate Blue**
```css
--primary: #2563eb       /* Professional Blue */
--accent: #f59e0b        /* Warm Yellow */
--profile: #2563eb       /* Matches primary */
```
**Best for**: Enterprise, logistics, professional services

---

### **Template 2: Fresh Green**
```css
--primary: #059669       /* Forest Green */
--accent: #fbbf24        /* Gold */
--profile: #059669       /* Matches primary */
```
**Best for**: Food safety, sustainability, health

---

### **Template 3: Modern Purple**
```css
--primary: #7c3aed       /* Vibrant Purple */
--accent: #fbbf24        /* Bright Yellow */
--profile: #7c3aed       /* Matches primary */
```
**Best for**: Tech startups, modern brands

---

### **Template 4: Bold Red**
```css
--primary: #dc2626       /* Bold Red */
--accent: #06b6d4        /* Cool Cyan */
--profile: #dc2626       /* Matches primary */
```
**Best for**: Urgent/critical operations, emergency services

---

### **Template 5: Clean Cyan**
```css
--primary: #0891b2       /* Clean Cyan */
--accent: #f59e0b        /* Warm Orange */
--profile: #0891b2       /* Matches primary */
```
**Best for**: Medical, pharmaceutical, clean industries

---

## Implementation Recommendations

### **Phase 1: Current State** ✅ (Implemented)
- Primary Color
- Accent Color
- Profile Avatar Color
- Favicon/Logo
- Login Background

### **Phase 2: Enhanced Branding** (Future)
- **Theme Mode**: Light/Dark toggle
- **Button Style**: Rounded vs. Sharp corners
- **Card Style**: Flat vs. Elevated
- **Color Presets**: Quick template selection

### **Phase 3: Advanced Customization** (Future)
- Custom CSS injection (for advanced users)
- Font family selection
- Spacing/density preferences
- Custom status color overrides (with warnings)

---

## Accessibility Guidelines

### Contrast Requirements

**WCAG AA Standard (Minimum):**
- Normal text: 4.5:1 contrast ratio
- Large text: 3:1 contrast ratio
- UI components: 3:1 contrast ratio

**Test Your Colors:**
- Use online contrast checkers: https://webaim.org/resources/contrastchecker/
- Ensure primary color on white has ≥4.5:1 ratio
- Ensure primary color on dark backgrounds has ≥4.5:1 ratio

### Color Blindness Considerations

**Do NOT rely on color alone** to convey information:
- Use icons + color for status indicators
- Use text labels alongside colored badges
- Provide texture/patterns for charts

**Safe Color Combinations:**
- Blue + Orange (safe for most types)
- Blue + Yellow (safe for most types)
- Avoid: Red + Green only (deuteranopia issue)

---

## Brand Guidelines for Workspaces

### **Choosing Your Primary Color**

1. **Match your brand identity**
   - Use your company's existing brand color
   - Ensure it translates well to digital interfaces

2. **Consider your industry**
   - Food: Warm tones (red, orange, yellow)
   - Tech: Cool tones (blue, purple, cyan)
   - Medical: Clean tones (blue, white, green)
   - Logistics: Professional (blue, dark gray)

3. **Test for readability**
   - View on different devices (mobile, desktop)
   - Test in bright and dim lighting
   - Check with colorblind simulation tools

### **Choosing Your Accent Color**

1. **Complement the primary**
   - Use color wheel: Complementary or Analogous schemes
   - Blue → Yellow/Orange (complementary)
   - Green → Yellow/Cyan (analogous)

2. **Create visual interest**
   - Accent should "pop" without overwhelming
   - Use sparingly (10-20% of interface)
   - Reserve for decorative elements and highlights

3. **Maintain hierarchy**
   - Primary = Most important actions
   - Accent = Secondary visual interest
   - Status colors = Semantic meaning

---

## Current Application in Thermio

### Where Primary Color Appears:
- ✅ Primary action buttons
- ✅ Active navigation links
- ✅ Focus/hover states
- ✅ Login page gradient balls (first ball)
- ✅ Brand logo background
- ✅ Progress indicators

### Where Accent Color Appears:
- ✅ Login page gradient balls (second ball)
- ✅ Secondary decorative elements
- ✅ Subtle highlights

### Where Status Colors Appear:
- 🟢 **Green**: Live status, active drivers, success messages
- 🔴 **Red**: Overdue alerts, errors, critical warnings, service due
- 🟡 **Yellow**: Pending actions, warnings, service soon

---

## Color Testing Checklist

Before finalizing workspace branding:

- [ ] Primary color has ≥4.5:1 contrast on white background
- [ ] Primary color has ≥4.5:1 contrast on dark background (#0f1117)
- [ ] Accent color complements (doesn't clash with) primary
- [ ] Login page gradient balls look good together
- [ ] Buttons are clearly visible and clickable
- [ ] All text is readable
- [ ] Brand feels consistent across all pages
- [ ] Color scheme works on mobile devices
- [ ] Tested with colorblind simulation (optional but recommended)

---

## Tools & Resources

### Color Contrast Checkers
- WebAIM Contrast Checker: https://webaim.org/resources/contrastchecker/
- Coolors Contrast Checker: https://coolors.co/contrast-checker

### Color Palette Generators
- Coolors: https://coolors.co/
- Adobe Color: https://color.adobe.com/

### Colorblind Simulators
- Coblis: https://www.color-blindness.com/coblis-color-blindness-simulator/
- Chrome DevTools: Built-in vision deficiency emulator

### Design Inspiration
- Dribbble Color Palettes: https://dribbble.com/colors/
- Material Design Colors: https://m2.material.io/design/color/

---

## Support

For questions about branding customization:
1. Review this guide
2. Test color combinations using online tools
3. Contact support if you need custom CSS or advanced modifications

---

**Last Updated**: February 2026
**Document Version**: 1.0
