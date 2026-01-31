// CRM Import/Export Component
import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Upload,
  Download,
  FileSpreadsheet,
  Check,
  X,
  AlertTriangle,
  FileDown,
} from 'lucide-react';
import {
  importContacts,
  exportContacts,
  exportLeads,
  exportOpportunities,
  type Contact,
  type Lead,
  type Opportunity,
  type ImportResult,
} from '@/lib/data/crm';
import { useToast } from '@/hooks/use-toast';
import { useCRMPermissions } from '@/hooks/useCRMPermissions';

interface FieldMapping {
  csvField: string;
  crmField: string;
}

const CRM_CONTACT_FIELDS = [
  { value: 'firstName', label: 'First Name' },
  { value: 'lastName', label: 'Last Name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'companyName', label: 'Company' },
  { value: 'jobTitle', label: 'Job Title' },
  { value: 'department', label: 'Department' },
  { value: 'notes', label: 'Notes' },
  { value: 'skip', label: '-- Skip --' },
];

interface CRMImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete?: () => void;
}

export function CRMImportDialog({ open, onOpenChange, onImportComplete }: CRMImportDialogProps) {
  const { toast } = useToast();
  const { canImportData } = useCRMPermissions();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [step, setStep] = useState<'upload' | 'mapping' | 'importing' | 'result'>('upload');
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').filter((line) => line.trim());
      const parsed = lines.map((line) => {
        // Simple CSV parsing (doesn't handle all edge cases)
        const values: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (const char of line) {
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim());
        return values;
      });

      if (parsed.length > 0) {
        setCsvHeaders(parsed[0]);
        setCsvData(parsed.slice(1));
        setFieldMappings(
          parsed[0].map((header) => ({
            csvField: header,
            crmField: guessFieldMapping(header),
          }))
        );
        setStep('mapping');
      }
    };
    reader.readAsText(file);
  };

  const guessFieldMapping = (header: string): string => {
    const h = header.toLowerCase();
    if (h.includes('first') && h.includes('name')) return 'firstName';
    if (h.includes('last') && h.includes('name')) return 'lastName';
    if (h === 'name' || h === 'full name') return 'firstName';
    if (h.includes('email')) return 'email';
    if (h.includes('phone') || h.includes('tel')) return 'phone';
    if (h.includes('company') || h.includes('organization')) return 'companyName';
    if (h.includes('title') || h.includes('position')) return 'jobTitle';
    if (h.includes('department') || h.includes('dept')) return 'department';
    if (h.includes('note')) return 'notes';
    return 'skip';
  };

  const handleImport = async () => {
    setStep('importing');
    setImportProgress(0);

    const contacts: Partial<Contact>[] = csvData.map((row) => {
      const contact: Partial<Contact> = {};
      fieldMappings.forEach((mapping, index) => {
        if (mapping.crmField !== 'skip' && row[index]) {
          (contact as any)[mapping.crmField] = row[index];
        }
      });
      return contact;
    });

    // Simulate progress
    for (let i = 0; i <= 100; i += 10) {
      setImportProgress(i);
      await new Promise((r) => setTimeout(r, 100));
    }

    const result = importContacts(contacts);
    setImportResult(result);
    setStep('result');
    
    if (result.success > 0) {
      onImportComplete?.();
    }
  };

  const handleClose = () => {
    setStep('upload');
    setCsvData([]);
    setCsvHeaders([]);
    setFieldMappings([]);
    setImportResult(null);
    onOpenChange(false);
  };

  if (!canImportData) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Contacts</DialogTitle>
          <DialogDescription>
            Upload a CSV file to import contacts into your CRM
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="py-8">
            <div
              className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="font-medium">Click to upload or drag and drop</p>
              <p className="text-sm text-muted-foreground mt-1">CSV files only</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
            <div className="mt-4 text-sm text-muted-foreground">
              <p className="font-medium mb-2">Expected columns:</p>
              <p>First Name, Last Name, Email, Phone, Company, Job Title</p>
            </div>
          </div>
        )}

        {step === 'mapping' && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Found {csvData.length} records. Map CSV columns to CRM fields:
            </div>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>CSV Column</TableHead>
                    <TableHead>Sample Data</TableHead>
                    <TableHead>Map To</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fieldMappings.map((mapping, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{mapping.csvField}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {csvData[0]?.[index] || '-'}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={mapping.crmField}
                          onValueChange={(v) => {
                            const newMappings = [...fieldMappings];
                            newMappings[index].crmField = v;
                            setFieldMappings(newMappings);
                          }}
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CRM_CONTACT_FIELDS.map((field) => (
                              <SelectItem key={field.value} value={field.value}>
                                {field.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('upload')}>
                Back
              </Button>
              <Button onClick={handleImport}>
                Import {csvData.length} Records
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'importing' && (
          <div className="py-8 text-center">
            <FileSpreadsheet className="h-12 w-12 text-primary mx-auto mb-4 animate-pulse" />
            <p className="font-medium mb-4">Importing contacts...</p>
            <Progress value={importProgress} className="w-full max-w-xs mx-auto" />
            <p className="text-sm text-muted-foreground mt-2">{importProgress}%</p>
          </div>
        )}

        {step === 'result' && importResult && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-6 text-center">
                  <Check className="h-8 w-8 text-success mx-auto mb-2" />
                  <p className="text-2xl font-bold">{importResult.success}</p>
                  <p className="text-sm text-muted-foreground">Imported</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6 text-center">
                  <AlertTriangle className="h-8 w-8 text-warning mx-auto mb-2" />
                  <p className="text-2xl font-bold">{importResult.duplicates}</p>
                  <p className="text-sm text-muted-foreground">Duplicates</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6 text-center">
                  <X className="h-8 w-8 text-destructive mx-auto mb-2" />
                  <p className="text-2xl font-bold">{importResult.failed}</p>
                  <p className="text-sm text-muted-foreground">Failed</p>
                </CardContent>
              </Card>
            </div>
            
            {importResult.errors.length > 0 && (
              <div className="p-4 bg-destructive/10 rounded-lg">
                <p className="font-medium text-destructive mb-2">Errors:</p>
                <ul className="text-sm space-y-1">
                  {importResult.errors.slice(0, 5).map((error, i) => (
                    <li key={i} className="text-muted-foreground">{error}</li>
                  ))}
                </ul>
              </div>
            )}
            
            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Export Component
interface CRMExportButtonProps {
  type: 'contacts' | 'leads' | 'opportunities';
  variant?: 'default' | 'outline' | 'ghost';
}

export function CRMExportButton({ type, variant = 'outline' }: CRMExportButtonProps) {
  const { toast } = useToast();
  const { canExportData } = useCRMPermissions();

  const handleExport = () => {
    let data: any[];
    let filename: string;
    let headers: string[];

    switch (type) {
      case 'contacts':
        data = exportContacts();
        filename = 'crm_contacts.csv';
        headers = ['First Name', 'Last Name', 'Email', 'Phone', 'Company', 'Job Title', 'Status'];
        break;
      case 'leads':
        data = exportLeads();
        filename = 'crm_leads.csv';
        headers = ['Title', 'Contact Name', 'Email', 'Company', 'Source', 'Status', 'Expected Revenue'];
        break;
      case 'opportunities':
        data = exportOpportunities();
        filename = 'crm_opportunities.csv';
        headers = ['Name', 'Contact', 'Company', 'Stage', 'Expected Revenue', 'Probability', 'Close Date'];
        break;
    }

    // Convert to CSV
    const csvRows = [headers.join(',')];
    
    data.forEach((item) => {
      let row: string[];
      switch (type) {
        case 'contacts':
          row = [
            item.firstName,
            item.lastName,
            item.email,
            item.phone || '',
            item.companyName || '',
            item.jobTitle || '',
            item.status,
          ];
          break;
        case 'leads':
          row = [
            item.title,
            item.contactName,
            item.email,
            item.companyName || '',
            item.source,
            item.status,
            item.expectedRevenue.toString(),
          ];
          break;
        case 'opportunities':
          row = [
            item.name,
            item.contactName,
            item.companyName || '',
            item.stage,
            item.expectedRevenue.toString(),
            item.probability.toString(),
            item.expectedCloseDate,
          ];
          break;
      }
      csvRows.push(row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','));
    });

    // Download file
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);

    toast({
      title: 'Export Complete',
      description: `Exported ${data.length} ${type}`,
    });
  };

  if (!canExportData) {
    return null;
  }

  return (
    <Button variant={variant} onClick={handleExport} className="gap-2">
      <FileDown className="h-4 w-4" />
      Export
    </Button>
  );
}
