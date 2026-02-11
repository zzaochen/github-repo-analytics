export default function ChartCard({ title, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">{title}</h3>
      <div style={{ width: '100%', height: '256px' }}>
        {children}
      </div>
    </div>
  );
}
