import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IsBoolean, IsUUID } from 'class-validator';
import type { Request, Response } from 'express';
import type { CallDetailDto, CallDto } from '@help/shared';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { StorageService, storageKeys } from '../storage/storage.service';
import { CallsService } from './calls.service';

class StartCallBody {
  @IsUUID()
  requestId: string;
}

class ConsentBody {
  @IsBoolean()
  granted: boolean;
}

const MEDIA_URL_TTL_SECONDS = 15 * 60;

@Controller()
export class CallsController {
  constructor(
    private readonly calls: CallsService,
    private readonly auth: AuthService,
    private readonly storage: StorageService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Get('rtc-config')
  rtcConfig() {
    return { iceServers: this.cfg.ICE_SERVERS };
  }

  @Get('calls')
  history(@CurrentUser() user: AuthUser): Promise<CallDto[]> {
    return this.calls.history(user);
  }

  @Get('calls/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<CallDetailDto> {
    return this.calls.detail(user, id);
  }

  @Roles('CONSULTANT')
  @Post('calls')
  start(@CurrentUser() user: AuthUser, @Body() body: StartCallBody): Promise<CallDto> {
    return this.calls.start(user, body.requestId);
  }

  @Roles('CLIENT')
  @Post('calls/:id/consent')
  @HttpCode(200)
  consent(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: ConsentBody) {
    return this.calls.setConsent(user, id, body.granted);
  }

  @Post('calls/:id/end')
  @HttpCode(200)
  end(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<CallDto> {
    return this.calls.end(user, id);
  }

  /**
   * Raw WebM chunk from the consultant's MediaRecorder (Content-Type: application/octet-stream).
   * Voice-activity samples for the chunk ride along in the X-Activity header as JSON.
   */
  @Roles('CONSULTANT')
  @SkipThrottle()
  @Post('calls/:id/recording/chunks')
  @HttpCode(200)
  async uploadChunk(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('segment') segment: string,
    @Query('seq') seq: string,
    @Query('offsetMs') offsetMs: string,
    @Headers('x-activity') activityHeader: string | undefined,
    @Req() req: Request,
  ) {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new BadRequestException('Expected a binary body');
    const nums = [segment, seq, offsetMs].map((v) => Number.parseInt(v, 10));
    if (nums.some((n) => !Number.isInteger(n) || n < 0)) throw new BadRequestException('Invalid segment/seq/offsetMs');

    let activity: unknown = null;
    if (activityHeader) {
      try {
        activity = JSON.parse(activityHeader);
      } catch {
        activity = null; // activity is best-effort; never fail an upload over it
      }
    }
    return this.calls.uploadChunk(user, id, {
      segment: nums[0],
      seq: nums[1],
      segmentOffsetMs: nums[2],
      body,
      activity,
    });
  }

  @Roles('CONSULTANT')
  @Post('calls/:id/recording/complete')
  @HttpCode(204)
  async complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.calls.completeRecording(user, id);
  }

  /**
   * A <video> element cannot send an Authorization header, so after the ownership check
   * we hand out a short-lived URL: a presigned object-store URL, or our own media endpoint
   * with a signed, call-scoped token.
   */
  @Get('calls/:id/recording/url')
  async recordingUrl(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const key = await this.calls.recordingKeyFor(user, id);
    const presigned = await this.storage.presignedGetUrl(key, MEDIA_URL_TTL_SECONDS);
    if (presigned) return { url: presigned };
    const token = await this.auth.signMediaToken(id, user.id);
    return { url: `/api/media/calls/${id}?token=${encodeURIComponent(token)}` };
  }

  /** Streams the recording from local disk. Express's sendFile handles HTTP Range, so seeking works. */
  @Public()
  @SkipThrottle()
  @Get('media/calls/:id')
  async media(@Param('id', ParseUUIDPipe) id: string, @Query('token') token: string, @Res() res: Response) {
    if (!token || !(await this.auth.verifyMediaToken(token, id))) throw new NotFoundException();
    const path = await this.storage.localPath(storageKeys.recording(id));
    if (!path) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(path, { headers: { 'Content-Type': 'video/webm' } });
  }
}
