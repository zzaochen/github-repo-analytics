import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import ChartCard from './ChartCard';

export default function IssuesChart({ data }) {
  const chartData = data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 100)) === 0);

  return (
    <ChartCard title="Issues Over Time">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <XAxis
            dataKey="date"
            tick={{ fill: '#9CA3AF', fontSize: 12 }}
            tickFormatter={(val) => val.slice(5)}
          />
          <YAxis
            tick={{ fill: '#9CA3AF', fontSize: 12 }}
            tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '8px' }}
            labelStyle={{ color: '#9CA3AF' }}
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
