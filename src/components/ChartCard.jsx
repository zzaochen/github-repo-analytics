export default function ChartCard({ title, children }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <h3 className="text-lg font-semibold mb-4 text-gray-200">{title}</h3>
      <div className="h-64">
        {children}
      </div>
    </div>
  );
}
