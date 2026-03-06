export default function ChartCard({ title, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm overflow-hidden">
      <h3 className="text-xs font-semibold mb-2 text-gray-800 truncate">{title}</h3>
      <div style={{ width: '100%', height: '180px' }}>
        {children}
      </div>
    </div>
  );
}
