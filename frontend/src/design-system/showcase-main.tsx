import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import 'antd/dist/reset.css';
import '../styles.css';
import './showcase.css';
import { wrightTestTheme } from './tokens';
import DesignSystemShowcase from './showcase/DesignSystemShowcase';

const root = document.getElementById('design-system-root');

if (!root) {
  throw new Error('Design system showcase root was not found');
}

if (import.meta.env.DEV) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ConfigProvider theme={wrightTestTheme}>
        <DesignSystemShowcase />
      </ConfigProvider>
    </React.StrictMode>
  );
}
