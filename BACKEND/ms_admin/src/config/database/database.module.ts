import { Module, Global } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import config from '../config';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [config.KEY],
      useFactory: (configService: ConfigType<typeof config>) => {
        const {
          host,
          port,
          database,
          logging,
          username,
          password,
          synchronize,
        } = configService.typeorm;
        return {
          type: 'mysql',
          host,
          port,
          database,
          username,
          logging: logging == 'true',
          password,
          synchronize: synchronize == 'true',
          autoLoadEntities: true,
        };
      },
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
