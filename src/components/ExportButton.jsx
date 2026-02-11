import { useState } from 'react';
import { exportToCSV, exportToXLSX } from '../utils/csvExport';

export default function ExportButton({ data, repoName }) {
  const [showMenu, setShowMenu] = useState(false);

  const handleExport = (format) => {
    if (format === 'csv') {
      exportToCSV(data, repoName);
    } else {
      exportToXLSX(data, repoName);
    }
    setShowMenu(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
        Export
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {showMenu && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowMenu(false)}
          />
          <div className="absolute right-0 mt-2 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
            <button
              onClick={() => handleExport('csv')}
              className="w-full px-4 py-2 text-left hover:bg-gray-100 transition-colors flex items-center gap-2"
            >
              <span className="text-green-600 font-mono text-sm">CSV</span>
              <span className="text-gray-500 text-sm">(.csv)</span>
            </button>
            <button
              onClick={() => handleExport('xlsx')}
              className="w-full px-4 py-2 text-left hover:bg-gray-100 transition-colors flex items-center gap-2"
            >
              <span className="text-blue-600 font-mono text-sm">Excel</span>
              <span className="text-gray-500 text-sm">(.xlsx)</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
