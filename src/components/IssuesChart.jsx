import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import ChartCard from './ChartCard';

export default function IssuesChart({ data }) {
  // Sample data for performance, but always include the last data point
  const step = Math.max(1, Math.floor(data.length / 100));
  const sampledData = data.filter((_, i) => i % step === 0);
  // Ensure last data point is included
  if (data.length > 0 && sampledData[sampledData.length - 1] !== data[data.length - 1]) {
    sampledData.push(data[data.length - 1]);
  }
  const chartData = sampledData;

  return (
    <ChartCard title="Issues Over Time">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <XAxis
            dataKey="date"
            tick={{ fill: '#6B7280', fontSize: 10 }}
            tickFormatter={(val) => {
              const date = new Date(val);
              const month = date.toLocaleDateString('en-US', { month: 'short' });
              const year = date.getFullYear().toString().slice(-2);
              return `${month}-${year}`;
            }}
          />
          <YAxis
            tick={{ fill: '#6B7280', fontSize: 10 }}
            tickFormatter={(val) => val.toLocaleString('en-US')}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
            labelStyle={{ color: '#374151' }}
            formatter={(value, name) => [value.toLocaleString('en-US'), name]}
          />
          <Legend />
          <Area
            type="monotone"
            dataKey="totalIssuesOpened"
            stackId="1"
            stroke="#A78BFA"
            fill="#A78BFA"
            fillOpacity={0.5}
            name="Opened"
          />
          <Area
            type="monotone"
            dataKey="totalIssuesClosed"
            stackId="2"
            stroke="#34D399"
            fill="#34D399"
            fillOpacity={0.5}
            name="Closed"
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
