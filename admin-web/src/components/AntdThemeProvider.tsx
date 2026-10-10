'use client';

import type { ReactNode } from 'react';
import { App as AntdApp, ConfigProvider, theme as antdTheme, type ThemeConfig } from 'antd';

const theme: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: '#1677ff',
    colorInfo: '#1677ff',
    colorSuccess: '#389e0d',
    colorWarning: '#d89614',
    colorError: '#cf1322',
    colorText: 'rgba(0, 0, 0, 0.88)',
    colorTextSecondary: 'rgba(0, 0, 0, 0.65)',
    colorBorder: '#d9d9d9',
    colorBorderSecondary: '#f0f0f0',
    colorBgLayout: '#f5f7fa',
    colorBgContainer: '#ffffff',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: 14,
    borderRadius: 8,
    controlHeight: 40,
    controlHeightLG: 48,
    controlHeightSM: 32,
    wireframe: false,
  },
  components: {
    Button: {
      borderRadius: 6,
      controlHeight: 40,
      fontWeight: 600,
    },
    Card: {
      borderRadiusLG: 8,
    },
    Input: {
      controlHeight: 40,
    },
    InputNumber: {
      controlHeight: 40,
    },
    Modal: {
      borderRadiusLG: 8,
    },
    Select: {
      controlHeight: 40,
    },
    Table: {
      borderColor: '#f0f0f0',
      headerBg: '#fafafa',
      headerColor: 'rgba(0, 0, 0, 0.65)',
      cellFontSize: 14,
      cellPaddingBlock: 12,
      cellPaddingInline: 16,
      rowHoverBg: '#fafafa',
    },
  },
};

export function AntdThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider theme={theme}>
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}
