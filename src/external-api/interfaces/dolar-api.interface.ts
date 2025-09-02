export interface DolarApiResponse {
  compra: number;
  venta: number;
  casa: string;
  nombre: string;
  moneda: string;
  fechaActualizacion: string;
}

export interface ApiCallResult {
  success: boolean;
  data?: DolarApiResponse;
  error?: string;
  responseTime?: number;
}
