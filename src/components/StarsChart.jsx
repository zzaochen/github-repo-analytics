import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import ChartCard from './ChartCard';

export default function StarsChart({ data }) {
  const chartData = data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 100)) === 0);

  return (
    <ChartCard title="Stars Over Time">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
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
          <Line
            type="monotone"
            dataKey="totalStars"
            stroke="#FBBF24"
            strokeWidth={2}
            dot={false}
            name="Total Stars"
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
