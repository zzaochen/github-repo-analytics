import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import ChartCard from './ChartCard';

export default function PRsChart({ data }) {
  const chartData = data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 100)) === 0);

  return (
    <ChartCard title="Pull Requests Over Time">
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={chartData}>
          <XAxis
            dataKey="date"
            tick={{ fill: '#6B7280', fontSize: 12 }}
            tickFormatter={(val) => val.slice(5)}
          />
          <YAxis
            tick={{ fill: '#6B7280', fontSize: 12 }}
            tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
            labelStyle={{ color: '#374151' }}
          />
          <Legend />
          <Area
            type="monotone"
            dataKey="totalPRsOpened"
            stackId="1"
            stroke="#F472B6"
            fill="#F472B6"
            fillOpacity={0.5}
            name="Opened"
          />
          <Area
            type="monotone"
            dataKey="totalPRsMerged"
            stackId="2"
            stroke="#34D399"
            fill="#34D399"
            fillOpacity={0.5}
            name="Merged"
          />
          <Area
            type="monotone"
            dataKey="totalPRsClosed"
            stackId="3"
            stroke="#FB923C"
            fill="#FB923C"
            fillOpacity={0.5}
            name="Closed"
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
