import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listCategories, saveCategory, deleteCategory,
} from '@/lib/services/inventory/categories';
import {
  listAttributes, saveAttribute, deleteAttribute,
  saveAttributeValue, deleteAttributeValue,
  listAssignmentsForProduct, setAssignmentsForProduct, listAttributesForProduct,
} from '@/lib/services/inventory/attributes';
import {
  listUnitsOfMeasure, saveUnitOfMeasure, deleteUnitOfMeasure,
} from '@/lib/services/inventory/unitsOfMeasure';
import {
  listOperationTypes, saveOperationType, deleteOperationType,
} from '@/lib/services/inventory/operationTypes';

// ------- Categories -------
const CAT_KEY = ['product-categories'] as const;
export const useProductCategories = () =>
  useQuery({ queryKey: CAT_KEY, queryFn: listCategories });
export const useSaveProductCategory = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: saveCategory, onSuccess: () => qc.invalidateQueries({ queryKey: CAT_KEY }) });
};
export const useDeleteProductCategory = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: deleteCategory, onSuccess: () => qc.invalidateQueries({ queryKey: CAT_KEY }) });
};

// ------- Attributes -------
const ATTR_KEY = ['product-attributes'] as const;
export const useProductAttributes = () =>
  useQuery({ queryKey: ATTR_KEY, queryFn: listAttributes });
export const useSaveProductAttribute = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: saveAttribute, onSuccess: () => qc.invalidateQueries({ queryKey: ATTR_KEY }) });
};
export const useDeleteProductAttribute = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: deleteAttribute, onSuccess: () => qc.invalidateQueries({ queryKey: ATTR_KEY }) });
};
export const useSaveProductAttributeValue = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: saveAttributeValue, onSuccess: () => qc.invalidateQueries({ queryKey: ATTR_KEY }) });
};
export const useDeleteProductAttributeValue = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: deleteAttributeValue, onSuccess: () => qc.invalidateQueries({ queryKey: ATTR_KEY }) });
};

// Product attribute assignments
const PA_KEY = (productId: string) => ['product-attribute-assignments', productId] as const;
export const useProductAttributeAssignments = (productId?: string) =>
  useQuery({
    queryKey: PA_KEY(productId ?? ''),
    queryFn: () => listAssignmentsForProduct(productId!),
    enabled: !!productId,
  });
export const useSetProductAttributeAssignments = (productId?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attributeIds: string[]) => setAssignmentsForProduct(productId!, attributeIds),
    onSuccess: () => {
      if (productId) {
        qc.invalidateQueries({ queryKey: PA_KEY(productId) });
        qc.invalidateQueries({ queryKey: ['product-attributes-for', productId] });
      }
    },
  });
};
export const useProductAssignedAttributes = (productId?: string) =>
  useQuery({
    queryKey: ['product-attributes-for', productId ?? ''],
    queryFn: () => listAttributesForProduct(productId!),
    enabled: !!productId,
  });

// ------- UoM -------
const UOM_KEY = ['units-of-measure'] as const;
export const useUnitsOfMeasure = () =>
  useQuery({ queryKey: UOM_KEY, queryFn: listUnitsOfMeasure });
export const useSaveUnitOfMeasure = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: saveUnitOfMeasure, onSuccess: () => qc.invalidateQueries({ queryKey: UOM_KEY }) });
};
export const useDeleteUnitOfMeasure = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: deleteUnitOfMeasure, onSuccess: () => qc.invalidateQueries({ queryKey: UOM_KEY }) });
};

// ------- Operation Types -------
const OT_KEY = ['operation-types'] as const;
export const useOperationTypes = () =>
  useQuery({ queryKey: OT_KEY, queryFn: listOperationTypes });
export const useSaveOperationType = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: saveOperationType, onSuccess: () => qc.invalidateQueries({ queryKey: OT_KEY }) });
};
export const useDeleteOperationType = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: deleteOperationType, onSuccess: () => qc.invalidateQueries({ queryKey: OT_KEY }) });
};