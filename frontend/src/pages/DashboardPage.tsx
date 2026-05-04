import { useEffect, useState } from 'react';
import { CheckCircleOutlined, CloseCircleOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Card, Col, Layout, Row, Select, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import UserMenu from '../components/UserMenu';
import { getDashboard, getFlakyTests } from '../api/client';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

interface DashboardData {
  summary: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    avgDurationMs: number;
  };
  chart: {
    date: string;
    passed: number;
    failed: number;
    total: number;
    passRate: number;
  }[];
}

interface FlakyTest {
  testId: string;
  testName: string;
  totalRuns: number;
  passed: number;
  failed: number;
}

const { Content } = Layout;
const { Title, Text } = Typography;

export default function DashboardPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<DashboardData | null>(null);
  const [flakyTests, setFlakyTests] = useState<FlakyTest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getDashboard(days),
      getFlakyTests()
    ])
      .then(([dashboardResponse, flakyResponse]) => {
        setData(dashboardResponse as DashboardData);
        setFlakyTests(flakyResponse as FlakyTest[]);
      })
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f7f3ff 0%, #eef4ff 55%, #ffffff 100%)' }}>
      <AppHeader
        actions={[
          <Link key="projects" to="/projects" style={{ color: '#fff' }}>Projects</Link>,
          <UserMenu key="menu" />
        ]}
      />
      <Content style={{ padding: 32, maxWidth: 1280, width: '100%', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <Title level={2} style={{ margin: 0 }}>Dashboard</Title>
            <Text type="secondary">Pass rate, duration, and test stability over time.</Text>
          </div>
          <Select
            value={days}
            onChange={setDays}
            style={{ width: 160 }}
            options={[
              { value: 7, label: 'Last 7 days' },
              { value: 30, label: 'Last 30 days' },
              { value: 90, label: 'Last 90 days' }
            ]}
          />
        </div>

        {loading || !data ? (
          <Spin size="large" />
        ) : (
          <>
            <Row gutter={16} style={{ marginBottom: 24 }}>
              <Col xs={24} md={6}>
                <Card style={{ borderRadius: 20 }}>
                  <Statistic title="Total Runs" value={data.summary.total} prefix={<ThunderboltOutlined />} />
                </Card>
              </Col>
              <Col xs={24} md={6}>
                <Card style={{ borderRadius: 20 }}>
                  <Statistic
                    title="Passed"
                    value={data.summary.passed}
                    valueStyle={{ color: '#52c41a' }}
                    prefix={<CheckCircleOutlined />}
                  />
                </Card>
              </Col>
              <Col xs={24} md={6}>
                <Card style={{ borderRadius: 20 }}>
                  <Statistic
                    title="Failed"
                    value={data.summary.failed}
                    valueStyle={{ color: '#ff4d4f' }}
                    prefix={<CloseCircleOutlined />}
                  />
                </Card>
              </Col>
              <Col xs={24} md={6}>
                <Card style={{ borderRadius: 20 }}>
                  <Statistic
                    title="Pass Rate"
                    value={data.summary.passRate}
                    suffix="%"
                    valueStyle={{ color: data.summary.passRate >= 80 ? '#52c41a' : '#ff4d4f' }}
                  />
                </Card>
              </Col>
            </Row>

            <Card title="Pass Rate Over Time" style={{ marginBottom: 24, borderRadius: 20 }}>
              {data.chart.length === 0 ? (
                <Text type="secondary">No runs in selected period</Text>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={data.chart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
                    <Tooltip formatter={(value) => `${value}%`} />
                    <Legend />
                    <Line type="monotone" dataKey="passRate" name="Pass Rate" stroke="#52c41a" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card title="Runs Per Day" style={{ marginBottom: 24, borderRadius: 20 }}>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data.chart}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="passed" name="Passed" stroke="#52c41a" dot={false} />
                  <Line type="monotone" dataKey="failed" name="Failed" stroke="#ff4d4f" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Flaky Tests" style={{ borderRadius: 20 }}>
              <Table
                dataSource={flakyTests}
                rowKey="testId"
                pagination={false}
                locale={{ emptyText: 'No flaky tests detected in the last 7 days' }}
                columns={[
                  { title: 'Test', dataIndex: 'testName' },
                  { title: 'Total Runs', dataIndex: 'totalRuns', render: (value: number) => <Tag color="blue">{value}</Tag> },
                  { title: 'Passed', dataIndex: 'passed', render: (value: number) => <Tag color="green">{value}</Tag> },
                  { title: 'Failed', dataIndex: 'failed', render: (value: number) => <Tag color="red">{value}</Tag> }
                ]}
              />
            </Card>
          </>
        )}
      </Content>
    </Layout>
  );
}
