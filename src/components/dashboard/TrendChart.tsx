import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

interface TrendChartProps {
  data: { label: string; value: number }[];
  type?: 'line' | 'bar';
  height?: number;
  color?: string;
}

export function TrendChart({ data, type = 'line', height = 200, color = 'hsl(var(--primary))' }: TrendChartProps) {
  const Chart = type === 'bar' ? BarChart : LineChart;
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <Chart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 6,
              fontSize: 12,
            }}
          />
          {type === 'bar' ? (
            <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
          ) : (
            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ r: 3 }} />
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}