export default function ChartCard({ title, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
      <h3 className="text-sm font-semibold mb-2 text-gray-800">{title}</h3>
      <div style={{ width: '100%', height: '200px' }}>
        {children}
      </div>
    </div>
  );
}
