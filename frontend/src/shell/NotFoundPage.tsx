import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="Page not found"
      subTitle="The requested WrightTest page does not exist."
      extra={<Button type="primary" onClick={() => navigate('/dashboard')}>Open Dashboard</Button>}
    />
  );
}
