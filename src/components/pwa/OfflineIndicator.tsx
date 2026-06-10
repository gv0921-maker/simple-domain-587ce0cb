import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function OfflineIndicator() {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  if (online) return null;

  return (
    <div className="sticky top-0 z-40 w-full bg-amber-500/90 text-amber-950 text-xs text-center py-1.5 px-3 flex items-center justify-center gap-2">
      <WifiOff className="h-3.5 w-3.5" />
      You are offline — some features may not work
    </div>
  );
}