export default function ChartCard({ title, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 lg:p-4 shadow-sm">
      <h3 className="text-sm lg:text-lg font-semibold mb-3 lg:mb-4 text-gray-800">{title}</h3>
      <div style={{ width: '100%' }} className="h-48 lg:h-64">
        {children}
      </div>
    </div>
  );
}
