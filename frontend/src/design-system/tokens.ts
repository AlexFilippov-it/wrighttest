import { theme, type ThemeConfig } from 'antd';

export const designTokens = {
  color: {
    background: '#f5f6f8',
    surface: '#ffffff',
    elevated: '#ffffff',
    surfaceHover: '#f8f9fb',
    border: '#dfe3e8',
    borderStrong: '#c9d0d9',
    text: '#16181d',
    muted: '#667085',
    subtle: '#8a94a3',
    primary: '#2563eb',
    primaryHover: '#1d4ed8',
    primaryActive: '#1e40af',
    success: '#16803c',
    successSurface: '#edf8f1',
    warning: '#b45309',
    warningSurface: '#fff7e8',
    danger: '#c9362b',
    dangerSurface: '#fff1f0',
    infoSurface: '#eff6ff',
    focusRing: 'rgba(37, 99, 235, 0.28)',
    disabled: '#aab2bd',
    disabledSurface: '#f1f3f5'
  },
  typography: {
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    size: {
      caption: 12,
      small: 13,
      body: 14,
      medium: 16,
      headingSmall: 20,
      heading: 24,
      display: 30
    },
    weight: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700
    },
    lineHeight: {
      compact: 1.25,
      body: 1.5,
      relaxed: 1.65
    }
  },
  spacing: {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    8: 32,
    10: 40,
    12: 48
  },
  radius: {
    small: 6,
    control: 8,
    medium: 10,
    large: 12,
    xlarge: 16
  },
  shadow: {
    none: 'none',
    subtle: '0 1px 2px rgba(16, 24, 40, 0.05)',
    elevated: '0 8px 24px rgba(16, 24, 40, 0.08)'
  },
  controlHeight: {
    small: 28,
    default: 32,
    large: 36
  },
  layout: {
    sidebarWidth: 240,
    contentMaxWidth: 1440,
    pagePadding: 32,
    tabletPadding: 24,
    mobilePadding: 16
  },
  breakpoint: {
    desktop: 1200,
    tablet: 1024,
    mobile: 768
  }
} as const;

export const wrightTestTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: designTokens.color.primary,
    colorInfo: designTokens.color.primary,
    colorSuccess: designTokens.color.success,
    colorWarning: designTokens.color.warning,
    colorError: designTokens.color.danger,
    colorBgLayout: designTokens.color.background,
    colorBgContainer: designTokens.color.surface,
    colorBgElevated: designTokens.color.elevated,
    colorBorder: designTokens.color.border,
    colorBorderSecondary: '#eaedf0',
    colorText: designTokens.color.text,
    colorTextSecondary: designTokens.color.muted,
    colorTextTertiary: designTokens.color.subtle,
    colorTextDisabled: designTokens.color.disabled,
    colorBgContainerDisabled: designTokens.color.disabledSurface,
    fontFamily: designTokens.typography.fontFamily,
    fontSize: designTokens.typography.size.body,
    fontSizeSM: designTokens.typography.size.small,
    fontSizeLG: designTokens.typography.size.medium,
    lineHeight: designTokens.typography.lineHeight.body,
    borderRadius: designTokens.radius.control,
    borderRadiusLG: designTokens.radius.large,
    borderRadiusSM: designTokens.radius.small,
    controlHeight: designTokens.controlHeight.default,
    controlHeightLG: designTokens.controlHeight.large,
    controlHeightSM: designTokens.controlHeight.small,
    boxShadow: designTokens.shadow.elevated,
    boxShadowSecondary: designTokens.shadow.subtle,
    motionDurationFast: '0.12s',
    motionDurationMid: '0.18s',
    motionDurationSlow: '0.24s'
  },
  components: {
    Button: {
      fontWeight: designTokens.typography.weight.medium,
      primaryShadow: 'none',
      defaultShadow: 'none',
      dangerShadow: 'none'
    },
    Card: {
      headerBg: designTokens.color.surface,
      bodyPadding: designTokens.spacing[5],
      headerHeight: 44
    },
    Table: {
      headerBg: '#f8f9fb',
      headerColor: designTokens.color.muted,
      borderColor: '#eaedf0',
      rowHoverBg: designTokens.color.surfaceHover,
      cellPaddingBlock: 10,
      cellPaddingInline: 12,
      cellPaddingBlockSM: 8,
      cellPaddingInlineSM: 10
    },
    Input: {
      activeBorderColor: designTokens.color.primary,
      hoverBorderColor: designTokens.color.borderStrong,
      activeShadow: `0 0 0 3px ${designTokens.color.focusRing}`
    },
    Select: {
      activeBorderColor: designTokens.color.primary,
      hoverBorderColor: designTokens.color.borderStrong,
      activeOutlineColor: designTokens.color.focusRing
    },
    Modal: {
      contentBg: designTokens.color.elevated,
      headerBg: designTokens.color.elevated,
      titleFontSize: designTokens.typography.size.medium,
      titleLineHeight: designTokens.typography.lineHeight.body
    },
    Tabs: {
      itemSelectedColor: designTokens.color.primary,
      itemHoverColor: designTokens.color.primaryHover,
      inkBarColor: designTokens.color.primary,
      horizontalItemPadding: '10px 0'
    }
  }
};
