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
      [ConfigKey.ADMIN_MAX_SUBADMINS]: 3,
      [ConfigKey.SUBADMIN_MAX_MANAGERS]: 10,
    };

    return defaults[key];
  }

  async initializeDefaults(): Promise<void> {
    const configs = [
      {
        key: ConfigKey.ADMIN_MAX_SUBADMINS,
        value: 3,
        description: 'Maximum number of SUBADMIN accounts an ADMIN can create',
      },
      {
        key: ConfigKey.SUBADMIN_MAX_MANAGERS,
        value: 10,
        description: 'Maximum number of MANAGER accounts a SUBADMIN can create',
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
