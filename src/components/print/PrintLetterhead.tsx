import { useCompanySettings } from '@/hooks/companySettings';

export function PrintLetterhead() {
  const { data: c } = useCompanySettings();
  if (!c) return null;

  const addressLine = [c.address, c.city, c.state, c.pincode]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="flex items-start justify-between gap-6 border-b-2 border-black pb-4 mb-6">
      <div className="flex items-start gap-4">
        {c.logo_url ? (
          <img
            src={c.logo_url}
            alt={`${c.company_name} logo`}
            className="h-16 w-16 object-contain"
            crossOrigin="anonymous"
          />
        ) : (
          <div className="h-16 w-16 rounded bg-gray-100 flex items-center justify-center text-2xl font-black tracking-tight">
            {c.company_name.slice(0, 3).toUpperCase()}
          </div>
        )}
        <div>
          <div className="text-2xl font-bold tracking-tight">{c.company_name}</div>
          {addressLine && <div className="text-xs text-gray-700">{addressLine}</div>}
          {c.country && <div className="text-xs text-gray-700">{c.country}</div>}
          {c.phone && <div className="text-xs text-gray-700">Phone: {c.phone}</div>}
          {c.email && <div className="text-xs text-gray-700">Email: {c.email}</div>}
          {c.website && <div className="text-xs text-gray-700">{c.website}</div>}
        </div>
      </div>
      <div className="text-right text-xs">
        {c.gstin && (
          <div>
            <span className="text-gray-500">GSTIN:</span>{' '}
            <span className="font-mono font-semibold">{c.gstin}</span>
          </div>
        )}
      </div>
    </div>
  );
}