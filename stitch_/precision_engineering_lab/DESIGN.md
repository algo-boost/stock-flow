---
name: Precision Engineering Lab
colors:
  surface: '#f8f9fb'
  surface-dim: '#d9dadc'
  surface-bright: '#f8f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f6'
  surface-container: '#edeef0'
  surface-container-high: '#e7e8ea'
  surface-container-highest: '#e1e2e4'
  on-surface: '#191c1e'
  on-surface-variant: '#3e484d'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f3'
  outline: '#6e797e'
  outline-variant: '#bdc8ce'
  surface-tint: '#006780'
  primary: '#00647c'
  on-primary: '#ffffff'
  primary-container: '#007f9d'
  on-primary-container: '#fafdff'
  inverse-primary: '#6cd3f7'
  secondary: '#505f76'
  on-secondary: '#ffffff'
  secondary-container: '#d0e1fb'
  on-secondary-container: '#54647a'
  tertiary: '#894e00'
  on-tertiary: '#ffffff'
  tertiary-container: '#a86516'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#b7eaff'
  primary-fixed-dim: '#6cd3f7'
  on-primary-fixed: '#001f28'
  on-primary-fixed-variant: '#004e61'
  secondary-fixed: '#d3e4fe'
  secondary-fixed-dim: '#b7c8e1'
  on-secondary-fixed: '#0b1c30'
  on-secondary-fixed-variant: '#38485d'
  tertiary-fixed: '#ffdcbf'
  tertiary-fixed-dim: '#ffb873'
  on-tertiary-fixed: '#2d1600'
  on-tertiary-fixed-variant: '#6a3b00'
  background: '#f8f9fb'
  on-background: '#191c1e'
  surface-variant: '#e1e2e4'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md-mobile:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  title-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  mono-data:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
---

## Brand & Style
The design system is engineered for high-precision laboratory environments where clarity, speed, and accuracy are paramount. The brand personality is systematic, transparent, and functional, drawing inspiration from technical documentation and clean engineering interfaces. 

The visual style is **Corporate Modern** with a lean towards **Technical Minimalism**. It prioritizes information density without sacrificing legibility, utilizing a crisp white-on-gray foundation to ensure that interactive elements and status indicators remain the focal point. The aesthetic aligns with Feishu’s functional elegance—unobtrusive, highly structured, and optimized for rapid task completion in a workplace setting.

## Colors
The palette is rooted in a "Lab-White" philosophy. The primary **Cyan-Blue (#0891B2)** serves as the main driver for interaction and primary navigation, providing a technical, high-tech feel. 

- **Backgrounds:** Use the light gray neutral for the main canvas to reduce eye strain and provide contrast for white surfaces.
- **Surfaces:** Pure white is reserved for cards and containers to create a distinct "layered" hierarchy.
- **Semantic Logic:** Status colors are high-chroma to ensure immediate recognition of laboratory alerts or success states. Use low-opacity tints of these colors (e.g., 10% opacity) for background fills on badges and tags.

## Typography
The typography system uses **Inter** for its exceptional legibility and neutral tone, making it ideal for data-heavy management systems. For technical data, serial numbers, and robot IDs, **Geist** is introduced to provide a monospaced, engineering-centric feel.

- **Mobile Optimization:** Headings scale down on mobile to maintain vertical density.
- **Data Tables:** Use `mono-data` for inventory counts, timestamps, and hardware addresses to ensure character alignment.
- **Hierarchy:** Use font weight rather than size to distinguish between primary and secondary information in compact layouts.

## Layout & Spacing
This design system utilizes a **8px Grid System** with a compact-to-medium density. 

- **Desktop:** A 12-column fluid grid with a fixed left sidebar (240px). 
- **Mobile:** A single-column layout with 16px side margins. Bottom navigation is mandatory for primary actions.
- **Density:** In material lists, use 12px vertical padding (compact) to maximize the amount of information visible on one screen. For detail pages, use 24px (medium) to improve readability.
- **Touch Targets:** All interactive elements must maintain a minimum 44x44px hit area, even if the visual representation is smaller.

## Elevation & Depth
Elevation is handled through **Tonal Layers** and **Soft Ambient Shadows**. 

- **Level 0 (Base):** Light Gray (#F3F4F6) background.
- **Level 1 (Cards):** White surface with a 1px border (#E5E7EB) and a very soft shadow (0px 2px 4px rgba(0,0,0,0.05)).
- **Level 2 (Modals/Popovers):** White surface with a more pronounced shadow (0px 10px 15px rgba(0,0,0,0.1)) to suggest physical distance from the base layer.
- **Interactions:** On hover, cards should slightly lift by increasing shadow spread or adding a 1px primary-colored border.

## Shapes
The shape language is **Rounded**, striking a balance between the rigidity of laboratory equipment and the softness of modern SaaS interfaces.

- **Standard Elements:** Buttons, input fields, and small cards use an **8px radius** (`rounded-md`).
- **Containers:** Large page sections and main cards use a **16px radius** (`rounded-xl`).
- **Badges:** Use a fully rounded pill-shape for status indicators to distinguish them from interactive buttons.

## Components
- **Buttons:** Primary buttons use a solid Cyan-Blue fill with white text. Secondary buttons use a light gray fill or an outline. Action buttons on mobile should span the full width of their container for thumb-accessibility.
- **Status Badges:** Use low-saturation background tints (e.g., Light Green for "In Stock") with high-saturation text of the same hue. Include a small leading icon for accessibility.
- **Input Fields:** Labels must be persistent (no floating labels) for engineering clarity. Use a 1px gray border that transitions to Cyan-Blue on focus. Error states must include an error icon and descriptive text below the field.
- **Cards:** Material cards should feature a "Header-Body-Footer" structure. The header contains the ID and Status; the body contains the Material Name and Quantity; the footer contains the "Quick Action" buttons.
- **Skeleton Loaders:** Use a subtle pulse animation on a light gray base. Skeletons must mirror the exact shape and layout of the final card components.
- **Empty States:** Use simplified, mono-line technical illustrations of robots or laboratory crates to maintain the engineering aesthetic.