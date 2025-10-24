import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigKey } from '../common/enums/config-key.enum';

@Injectable()
export class SystemConfigService {
  constructor(private prisma: PrismaService) {}

  async getConfig(key: ConfigKey): Promise<number> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key },
    });

    if (!config) {
      // Return default values if not found in database
      return this.getDefaultValue(key);
    }

    return config.value;
  }

  async setConfig(
    key: ConfigKey,
    value: number,
    description?: string,
  ): Promise<void> {
    await this.prisma.systemConfig.upsert({
      where: { key },
      update: { value, description },
      create: { key, value, description },
    });
  }

  private getDefaultValue(key: ConfigKey): number {
    const defaults = {
      [ConfigKey.ADMIN_MAX_CLIENTS]: 450,
    };

    return defaults[key] || 0;
  }

  async initializeDefaults(): Promise<void> {
    const configs = [
      {
        key: ConfigKey.ADMIN_MAX_CLIENTS,
        value: 450,
        description: 'Maximum number of clients quota for each ADMIN',
      },
    ];

    for (const config of configs) {
      await this.prisma.systemConfig.upsert({
        where: { key: config.key },
        update: {},
        create: config,
      });
    }
  }
}
