import { Inject, Injectable, Logger } from '@nestjs/common';
import { envs, NATS_SERVICE } from 'src/config';
import Stripe from 'stripe';
import { PaymentSessionDto } from './dto/payment-session.dto';
import { Request, Response } from 'express';
import { ClientProxy } from '@nestjs/microservices';


@Injectable()
export class PaymentsService {
  private readonly stripe = new Stripe(envs.stripeSecret);
  private readonly logger = new Logger('PaymentsService');

  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy
  ) {}

  async createPaymentSession(paymensessionDto: PaymentSessionDto) {
    const { currency, items, orderId } = paymensessionDto;
    const lineItems = items.map((item) => {
      return {
        price_data: {
          currency,
          product_data: {
            name: item.name,
          },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity,
      };
    })
    const session = await this.stripe.checkout.sessions.create({
      payment_intent_data: {
        metadata: {
          orderId
        },
      },
      line_items: lineItems,
      mode: 'payment',
      success_url: envs.stripeSuccessUrl,
      cancel_url: envs.stripeCancelUrl,
    });
    return {
      cancelUrl: session.cancel_url,
      successUrl: session.success_url,
      url: session.url
    };
  }

  async stripeWebhook( req: Request, res: Response) {
    const sig = req.headers['stripe-signature'];
    let event: Stripe.Event;
    // Testing
    // const endpointSecret = 'whsec_aac52768ff68e6ee1b4d0a54b241f33f535217306d06c4032d7b03113473ae56';
    const endpointSecret = envs.stripeEndpointSecret;

    try {
      event = this.stripe.webhooks.constructEvent(req['rawBody'], sig ? sig : '', endpointSecret);
    } catch (err) {
      res.status(400).send(`Webhook error: ${err.message}`);
      return;
    }
    switch (event.type) {
      case 'charge.succeeded':
        const chargeSucceeded = event.data.object;
        const payload = {
          stripePaymentId: chargeSucceeded.id,
          orderId: chargeSucceeded.metadata.orderId,
          receiptUrl: chargeSucceeded.receipt_url
        }
        this.client.emit('payment.succeded', payload);
        break;

        default:
        console.log(`Unhandled event type ${event.type}`);
    }
    return res.status(200).json({
      sig
    });
  }
}
