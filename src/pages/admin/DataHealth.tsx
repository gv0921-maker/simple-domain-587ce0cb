import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";

type SerialRecon = {
  serial_id: string;
  serial_number: string | null;
  product_id: string | null;
  actual_status: string | null;
  actual_location: string | null;
  expected_location: string | null;
  expected_location_code: string | null;
  last_move_at: string | null;
  last_doc_type: string | null;
  last_move_ref: string | null;
  issue: string;
};

type NoHistory = {
  serial_id: string;
  serial_number: string | null;
  product_id: string | null;
  actual_status: string | null;
  actual_location: string | null;
  created_at: string;
};

type ResHealth = {
  reservation_id: string;
  sales_order_id: string | null;
  serial_number_id: string | null;
  serial_number: string | null;
  quantity: number | null;
  reservation_status: string | null;
  reserved_at: string | null;
  serial_stock_status: string | null;
  serial_location: string | null;
  so_reference: string | null;
  so_status: string | null;
  issue: string;
};

export default function DataHealth() {
  const [loading, setLoading] = useState(true);
  const [recon, setRecon] = useState<SerialRecon[]>([]);
  const [noHist, setNoHist] = useState<NoHistory[]>([]);
  const [resv, setResv] = useState<ResHealth[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const [a, b, c] = await Promise.all([
        supabase.from("serial_reconciliation" as never).select("*").limit(500),
        supabase.from("serials_without_history" as never).select("*").limit(500),
        supabase.from("reservation_health" as never).select("*").limit(500),
      ]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
      if (c.error) throw c.error;
      setRecon((a.data as unknown as SerialRecon[]) ?? []);
      setNoHist((b.data as unknown as NoHistory[]) ?? []);
      setResv((c.data as unknown as ResHealth[]) ?? []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const StatChip = ({
    count,
    kind,
  }: {
    count: number;
    kind: "error" | "info";
  }) => {
    if (count === 0) {
      return (
        <Badge variant="outline" className="gap-1">
          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
          Clean
        </Badge>
      );
    }
    return (
      <Badge variant={kind === "error" ? "destructive" : "secondary"} className="gap-1">
        {kind === "error" ? <AlertTriangle className="h-3 w-3" /> : <HelpCircle className="h-3 w-3" />}
        {count}
      </Badge>
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Data Health</h1>
          <p className="text-sm text-muted-foreground">
            Inventory ledger integrity checks. Both error sections should normally be empty.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {err && (
        <Card className="border-destructive">
          <CardContent className="p-4 text-sm text-destructive">{err}</CardContent>
        </Card>
      )}

      {/* Serial Reconciliation */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-base">Serial Reconciliation</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Serials whose current location disagrees with the latest completed stock move.
            </p>
          </div>
          <StatChip count={recon.length} kind="error" />
        </CardHeader>
        <CardContent>
          {recon.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No discrepancies. Every serial matches its ledger destination.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Serial</TableHead>
                    <TableHead>Actual location</TableHead>
                    <TableHead>Actual status</TableHead>
                    <TableHead>Expected location</TableHead>
                    <TableHead>Last move</TableHead>
                    <TableHead>Doc</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recon.map((r) => (
                    <TableRow key={r.serial_id}>
                      <TableCell className="font-mono text-xs">{r.serial_number ?? "—"}</TableCell>
                      <TableCell>{r.actual_location ?? "—"}</TableCell>
                      <TableCell>{r.actual_status ?? "—"}</TableCell>
                      <TableCell>{r.expected_location ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {r.last_move_at ? new Date(r.last_move_at).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{r.last_move_ref ?? r.last_doc_type ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reservation Health */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-base">Reservation Health</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Active reservations pointing at unavailable serials or closed orders.
            </p>
          </div>
          <StatChip count={resv.length} kind="error" />
        </CardHeader>
        <CardContent>
          {resv.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No stale reservations. Every active reservation is valid.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SO</TableHead>
                    <TableHead>SO status</TableHead>
                    <TableHead>Serial</TableHead>
                    <TableHead>Serial status</TableHead>
                    <TableHead>Issue</TableHead>
                    <TableHead>Reserved at</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resv.map((r) => (
                    <TableRow key={r.reservation_id}>
                      <TableCell className="text-xs">{r.so_reference ?? "—"}</TableCell>
                      <TableCell>{r.so_status ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.serial_number ?? "—"}</TableCell>
                      <TableCell>{r.serial_stock_status ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="destructive">{r.issue}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.reserved_at ? new Date(r.reserved_at).toLocaleString() : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pre-cutover serials */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-base">Serials Without Ledger History</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Pre-cutover stock. Not errors — this list shrinks as items move through the ledger.
            </p>
          </div>
          <StatChip count={noHist.length} kind="info" />
        </CardHeader>
        <CardContent>
          {noHist.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Every serial has ledger history.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Serial</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {noHist.slice(0, 200).map((r) => (
                    <TableRow key={r.serial_id}>
                      <TableCell className="font-mono text-xs">{r.serial_number ?? "—"}</TableCell>
                      <TableCell>{r.actual_status ?? "—"}</TableCell>
                      <TableCell>{r.actual_location ?? "—"}</TableCell>
                      <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {noHist.length > 200 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Showing first 200 of {noHist.length}.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}