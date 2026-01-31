import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Search,
  Plus,
  Shield,
  Users,
  Edit,
  Trash2,
  ChevronRight,
  Check,
  X,
} from 'lucide-react';
import { getRoles, MODULES, type Role, type PermissionLevel, type RecordScope } from '@/lib/data/rbac';
import { cn } from '@/lib/utils';

const SETTINGS_NAV = [
  { label: 'General', href: '/settings' },
  { label: 'Users', href: '/settings/users' },
  { label: 'Roles', href: '/settings/roles' },
  { label: 'Audit Logs', href: '/settings/audit' },
  { label: 'Backups', href: '/settings/backups' },
];

const PERMISSION_LEVELS: { id: PermissionLevel; label: string; color: string }[] = [
  { id: 'none', label: 'None', color: 'text-muted-foreground' },
  { id: 'view', label: 'View', color: 'text-info' },
  { id: 'create', label: 'Create', color: 'text-accent' },
  { id: 'edit', label: 'Edit', color: 'text-warning' },
  { id: 'delete', label: 'Delete', color: 'text-destructive' },
  { id: 'admin', label: 'Admin', color: 'text-success' },
];

function PermissionBadge({ level }: { level: PermissionLevel }) {
  const config = PERMISSION_LEVELS.find((p) => p.id === level);
  if (level === 'none') {
    return <X className="h-4 w-4 text-muted-foreground" />;
  }
  if (level === 'admin') {
    return <Check className="h-4 w-4 text-success" />;
  }
  return (
    <Badge variant="outline" className={cn('text-xs', config?.color)}>
      {config?.label}
    </Badge>
  );
}

export default function RolesManagement() {
  const [roles] = useState<Role[]>(() => getRoles());
  const [search, setSearch] = useState('');
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);

  const filteredRoles = roles.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase())
  );

  const getPermissionLevel = (role: Role, module: string): PermissionLevel => {
    const permission = role.permissions.find((p) => p.module === module);
    return permission?.level || 'none';
  };

  return (
    <AppLayout title="Settings" moduleNav={SETTINGS_NAV}>
      <div className="p-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-lg font-medium text-foreground">Roles & Permissions</h1>
              <p className="text-sm text-muted-foreground">
                Manage access control for your organization
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search roles..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button className="gap-1">
              <Plus className="h-4 w-4" />
              New Role
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Roles list */}
          <div className="lg:col-span-1 space-y-2">
            {filteredRoles.map((role, index) => (
              <Card
                key={role.id}
                className={cn(
                  'p-4 cursor-pointer transition-all duration-150 animate-fade-in',
                  selectedRole?.id === role.id
                    ? 'ring-2 ring-primary bg-primary/5'
                    : 'hover:bg-muted/50'
                )}
                style={{ animationDelay: `${index * 50}ms` }}
                onClick={() => setSelectedRole(role)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Shield className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-medium text-foreground">{role.name}</h3>
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {role.description}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {role.isSystem && (
                    <Badge variant="secondary" className="text-xs">System</Badge>
                  )}
                  <Badge variant="outline" className="text-xs">
                    {role.permissions.filter((p) => p.level !== 'none').length} modules
                  </Badge>
                </div>
              </Card>
            ))}
          </div>

          {/* Permission matrix */}
          <div className="lg:col-span-2">
            {selectedRole ? (
              <Card className="animate-fade-in">
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-medium text-foreground">{selectedRole.name}</h2>
                    <p className="text-sm text-muted-foreground">{selectedRole.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="gap-1">
                      <Edit className="h-4 w-4" />
                      Edit
                    </Button>
                    {!selectedRole.isSystem && (
                      <Button variant="outline" size="sm" className="gap-1 text-destructive">
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    )}
                  </div>
                </div>

                <div className="p-4">
                  <h3 className="text-sm font-medium text-foreground mb-3">Permission Matrix</h3>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[180px]">Module</TableHead>
                          <TableHead className="text-center">View</TableHead>
                          <TableHead className="text-center">Create</TableHead>
                          <TableHead className="text-center">Edit</TableHead>
                          <TableHead className="text-center">Delete</TableHead>
                          <TableHead className="text-center">Admin</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {MODULES.map((module) => {
                          const level = getPermissionLevel(selectedRole, module);
                          const levelWeight = PERMISSION_LEVELS.findIndex((p) => p.id === level);

                          return (
                            <TableRow key={module}>
                              <TableCell className="font-medium capitalize">{module}</TableCell>
                              {['view', 'create', 'edit', 'delete', 'admin'].map((perm, idx) => (
                                <TableCell key={perm} className="text-center">
                                  {levelWeight >= idx + 1 ? (
                                    <Check className="h-4 w-4 text-success mx-auto" />
                                  ) : (
                                    <X className="h-4 w-4 text-muted-foreground/30 mx-auto" />
                                  )}
                                </TableCell>
                              ))}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="p-12 text-center">
                <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <h3 className="text-lg font-medium text-foreground">Select a Role</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Click on a role to view and edit its permissions
                </p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
