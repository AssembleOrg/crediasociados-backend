import { Transform } from 'class-transformer';

/**
 * Transforma un valor Decimal de Prisma a número
 */
export const ToNumber = () => Transform(({ value }) => {
  if (value === null || value === undefined || value === '') {
    return value;
  }
  // Handle Prisma Decimal objects
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    return value.toNumber();
  }
  return Number(value);
});

/**
 * Transforma un array de objetos con campos Decimal a números
 */
export const ToNumberArray = (decimalFields: string[] = ['amount', 'totalAmount', 'paidAmount']) => 
  Transform(({ value }) => {
    if (!Array.isArray(value)) {
      return value;
    }
    
    return value.map((item: any) => {
      if (typeof item !== 'object' || item === null) {
        return item;
      }
      
      const transformed = { ...item };
      decimalFields.forEach(field => {
        if (transformed[field] !== null && transformed[field] !== undefined && transformed[field] !== '') {
          // Handle Prisma Decimal objects
          if (typeof transformed[field] === 'object' && 'toNumber' in transformed[field]) {
            transformed[field] = transformed[field].toNumber();
          } else {
            transformed[field] = Number(transformed[field]);
          }
        }
      });
      
      return transformed;
    });
  });

/**
 * Transforma un objeto con campos Decimal a números
 */
export const ToNumberObject = (decimalFields: string[] = ['amount', 'baseInterestRate', 'penaltyInterestRate', 'originalAmount']) =>
  Transform(({ value }) => {
    if (typeof value !== 'object' || value === null) {
      return value;
    }
    
    const transformed = { ...value };
    decimalFields.forEach(field => {
      if (transformed[field] !== null && transformed[field] !== undefined && transformed[field] !== '') {
        // Handle Prisma Decimal objects
        if (typeof transformed[field] === 'object' && 'toNumber' in transformed[field]) {
          transformed[field] = transformed[field].toNumber();
        } else {
          transformed[field] = Number(transformed[field]);
        }
      }
    });
    
    return transformed;
  });
