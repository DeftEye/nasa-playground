import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';

@Public()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('snowflake-info')
  getSnowflakeInfo() {
    return {
      message: 'Snowflake integration is ready!',
      endpoints: [
        'POST /snowflake/write - Write data to Snowflake tables',
        'POST /snowflake/create-table - Create a new table',
        'POST /snowflake/execute-query - Execute custom SQL queries',
        'GET /snowflake/tables - List all tables',
        'GET /snowflake/table/:tableName/schema - Get table schema',
      ],
      documentation: 'See SNOWFLAKE_README.md for detailed usage instructions',
    };
  }
}
