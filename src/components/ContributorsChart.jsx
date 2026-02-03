import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import ChartCard from './ChartCard';

export default function ContributorsChart({ data }) {
  const chartData = data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 100)) === 0);

  return (
    <ChartCard title="Contributors Growth">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <XAxis
            dataKey="date"
            tick={{ fill: '#9CA3AF', fontSize: 12 }}
            tickFormatter={(val) => val.slice(5)}
          />
          <YAxis
            tick={{ fill: '#9CA3AF', fontSize: 12 }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '8px' }}
            labelStyle={{ color: '#9CA3AF' }}
          />
          <Area
            type="monotone"
            dataKey="totalContributors"
            stroke="#34D399"
            fill="#34D399"
            fillOpacity={0.3}
            name="Total Contributors"
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
