import { Layout, Space, Typography } from 'antd';
import {
  APP_BUILD_DATE,
  APP_COPYRIGHT,
  APP_DESCRIPTION,
  APP_GIT_COMMIT,
  APP_VERSION,
  formatBuildDate
} from '../utils/appMeta';

const { Footer } = Layout;
const { Text } = Typography;

type AppFooterProps = {
  bottomPadding?: number;
};

export default function AppFooter({ bottomPadding = 28 }: AppFooterProps) {
  const buildDateLabel = formatBuildDate(APP_BUILD_DATE);

  return (
    <Footer style={{ background: 'transparent', padding: `20px 32px ${bottomPadding}px` }}>
      <div
        style={{
          maxWidth: 1560,
          margin: '0 auto',
          paddingTop: 16,
          borderTop: '1px solid rgba(148, 163, 184, 0.22)',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap'
        }}
      >
        <Space size={[8, 8]} wrap split={<Text type="secondary">·</Text>}>
          <Text style={{ color: 'rgba(15, 23, 42, 0.78)' }}>{APP_COPYRIGHT}</Text>
          <Text type="secondary">{APP_DESCRIPTION}</Text>
        </Space>

        <Space size={[8, 8]} wrap split={<Text type="secondary">·</Text>} style={{ justifyContent: 'flex-end' }}>
          <Text style={{ color: 'rgba(15, 23, 42, 0.78)' }}>{APP_VERSION}</Text>
          {APP_GIT_COMMIT ? <Text code>{APP_GIT_COMMIT}</Text> : null}
          {buildDateLabel ? <Text type="secondary">{buildDateLabel}</Text> : null}
        </Space>
      </div>
    </Footer>
  );
}
