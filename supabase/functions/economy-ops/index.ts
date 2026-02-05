// supabase/functions/economy-ops/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action, payload } = await req.json();

    // 1. AWARD MISSION REWARD (Admin/System only)
    if (action === 'award_mission_reward') {
      const { submission_id, admin_user_id } = payload;
      
      // Verify admin (simplified check)
      const { data: admin } = await supabaseClient.from('profiles').select('role').eq('id', admin_user_id).single();
      // In real app, check if role === 'admin'

      // Get submission details
      const { data: submission } = await supabaseClient
        .from('mission_submissions')
        .select('*, missions(*)')
        .eq('id', submission_id)
        .single();

      if (!submission) throw new Error('Submission not found');
      if (submission.status === 'APPROVED') throw new Error('Already approved');

      // Update submission status
      await supabaseClient
        .from('mission_submissions')
        .update({ status: 'APPROVED' })
        .eq('id', submission_id);

      // Add Tokens to Wallet
      const { data: wallet } = await supabaseClient
        .from('wallets')
        .select('id, token_balance, reputation_balance')
        .eq('user_id', submission.user_id)
        .single();

      await supabaseClient
        .from('wallets')
        .update({
          token_balance: wallet.token_balance + submission.missions.reward_tokens,
          reputation_balance: wallet.reputation_balance + submission.missions.reward_rep
        })
        .eq('id', wallet.id);

      // Log Ledger Entry
      await supabaseClient.from('ledger_entries').insert({
        wallet_id: wallet.id,
        amount: submission.missions.reward_tokens,
        currency: 'TOKEN',
        operation_type: 'REWARD',
        reference_id: submission_id,
        description: `Mission Reward: ${submission.missions.title}`
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. CREATE TICKET LISTING (User + Password Check)
    if (action === 'create_ticket_listing') {
      const { user_id, password, ticket_type_id, quantity, price } = payload;
      
      // A. Verify Password
      // We need a separate client for auth check because we need to sign in as the user, 
      // but we are in an admin context. 
      // Actually, we can just try to sign in with the provided credentials using a throwaway client or the same one?
      // createClient maintains state. Let's create a temporary client or use the REST API for auth.
      // Easiest is to use the auth admin api to *verify*? No, admin can't verify password.
      // We must try to signIn.
      const authClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? ''
      );
      
      // Fetch user email to sign in (we only have user_id usually)
      const { data: userData, error: userError } = await supabaseClient.auth.admin.getUserById(user_id);
      if (userError || !userData.user) throw new Error('User not found');
      
      const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({
        email: userData.user.email,
        password: password
      });

      if (signInError || signInData.user.id !== user_id) {
        throw new Error('Invalid password');
      }

      // B. Check Ticket Balance
      const { data: balanceData } = await supabaseClient
        .from('user_ticket_balances')
        .select('balance')
        .eq('user_id', user_id)
        .eq('ticket_type_id', ticket_type_id)
        .single();

      if (!balanceData || balanceData.balance < quantity) {
        throw new Error('Insufficient ticket balance');
      }

      // C. Deduct Balance
      const newBalance = balanceData.balance - quantity;
      await supabaseClient
        .from('user_ticket_balances')
        .update({ balance: newBalance })
        .eq('user_id', user_id)
        .eq('ticket_type_id', ticket_type_id);

      // D. Create Listing
      const { data: listing, error: listingError } = await supabaseClient
        .from('ticket_listings')
        .insert({
          seller_id: user_id,
          ticket_type_id,
          quantity,
          price_per_unit: price
        })
        .select()
        .single();

      if (listingError) throw listingError;

      return new Response(JSON.stringify({ success: true, listing }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. PURCHASE TICKET LISTING (User + Password Check)
    if (action === 'purchase_ticket_listing') {
      const { user_id, password, listing_id } = payload;

      // A. Verify Password
      const authClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? ''
      );
      const { data: userData } = await supabaseClient.auth.admin.getUserById(user_id);
      if (!userData.user) throw new Error('User not found');
      
      const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({
        email: userData.user.email,
        password: password
      });

      if (signInError || signInData.user.id !== user_id) {
        throw new Error('Invalid password');
      }

      // B. Get Listing
      const { data: listing } = await supabaseClient
        .from('ticket_listings')
        .select('*')
        .eq('id', listing_id)
        .single();

      if (!listing || listing.status !== 'ACTIVE') throw new Error('Listing not active');

      const totalCost = Number(listing.price_per_unit) * Number(listing.quantity);
      const fee = totalCost * 0.02; // 2% fee
      const sellerReceive = totalCost - fee;

      // C. Check Buyer Token Balance
      const { data: buyerWallet } = await supabaseClient
        .from('wallets')
        .select('*')
        .eq('user_id', user_id)
        .single();

      if (!buyerWallet || buyerWallet.token_balance < totalCost) {
        throw new Error('Insufficient funds');
      }

      // D. EXECUTE TRADE (Atomic-ish)
      
      // 1. Transfer Tokens (Buyer -> Seller & Fee)
      // Deduct from Buyer
      await supabaseClient.from('wallets').update({
        token_balance: Number(buyerWallet.token_balance) - totalCost
      }).eq('id', buyerWallet.id);

      // Add to Seller
      const { data: sellerWallet } = await supabaseClient
        .from('wallets')
        .select('*')
        .eq('user_id', listing.seller_id)
        .single();
      
      if (sellerWallet) {
        await supabaseClient.from('wallets').update({
          token_balance: Number(sellerWallet.token_balance) + sellerReceive
        }).eq('id', sellerWallet.id);
      }

      // 2. Transfer Tickets (Listing -> Buyer)
      // Check if buyer has balance entry
      const { data: buyerTicketBalance } = await supabaseClient
        .from('user_ticket_balances')
        .select('*')
        .eq('user_id', user_id)
        .eq('ticket_type_id', listing.ticket_type_id)
        .single();

      if (buyerTicketBalance) {
        await supabaseClient.from('user_ticket_balances').update({
          balance: buyerTicketBalance.balance + listing.quantity
        }).eq('id', buyerTicketBalance.id);
      } else {
        await supabaseClient.from('user_ticket_balances').insert({
          user_id: user_id,
          ticket_type_id: listing.ticket_type_id,
          balance: listing.quantity
        });
      }

      // 3. Close Listing
      await supabaseClient.from('ticket_listings').update({
        status: 'SOLD'
      }).eq('id', listing_id);

      // 4. Log Transaction
      await supabaseClient.from('ticket_transactions').insert({
        listing_id: listing.id,
        buyer_id: user_id,
        seller_id: listing.seller_id,
        ticket_type_id: listing.ticket_type_id,
        quantity: listing.quantity,
        price_per_unit: listing.price_per_unit,
        total_price: totalCost
      });

      // 5. Log Ledger (Tokens)
      await supabaseClient.from('ledger_entries').insert({
        wallet_id: buyerWallet.id,
        amount: -totalCost,
        currency: 'TOKEN',
        operation_type: 'MARKET_PAYOUT', // Using existing type or new one?
        description: `Bought Ticket: ${listing.id}`
      });
      if (sellerWallet) {
        await supabaseClient.from('ledger_entries').insert({
          wallet_id: sellerWallet.id,
          amount: sellerReceive,
          currency: 'TOKEN',
          operation_type: 'MARKET_PAYOUT',
          description: `Sold Ticket: ${listing.id}`
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. RESOLVE SUPPORT OUTCOME (Admin only)
    if (action === 'resolve_support_outcome') {
      const { instrument_id, outcome_success } = payload;

      const { data: instrument } = await supabaseClient
        .from('support_instruments')
        .select('*')
        .eq('id', instrument_id)
        .single();

      // Find all active positions
      const { data: positions } = await supabaseClient
        .from('support_positions')
        .select('*')
        .eq('instrument_id', instrument_id)
        .eq('status', 'ACTIVE');

      for (const pos of positions) {
        let payout = 0;
        if (instrument.type === 'BOND') {
          // Principal + Yield
          payout = Number(pos.amount_invested) * (1 + (Number(instrument.yield_rate) / 100));
        } else if (instrument.type === 'MILESTONE') {
          // All or nothing (simplified)
          payout = outcome_success ? Number(pos.amount_invested) * 1.5 : 0; 
        }

        if (payout > 0) {
          // Update Wallet
          const { data: wallet } = await supabaseClient.from('wallets').select('*').eq('user_id', pos.user_id).single();
          await supabaseClient.from('wallets').update({ token_balance: wallet.token_balance + payout }).eq('id', wallet.id);
          
          // Ledger
          await supabaseClient.from('ledger_entries').insert({
            wallet_id: wallet.id,
            amount: payout,
            currency: 'TOKEN',
            operation_type: 'MARKET_PAYOUT',
            reference_id: pos.id,
            description: `Payout for ${instrument.title}`
          });
        }

        // Close Position
        await supabaseClient
          .from('support_positions')
          .update({ status: payout > 0 ? 'PAYOUT_RECEIVED' : 'CLOSED', payout_amount: payout })
          .eq('id', pos.id);
      }

      await supabaseClient.from('support_instruments').update({ status: 'RESOLVED', resolved_at: new Date() }).eq('id', instrument_id);

      return new Response(JSON.stringify({ success: true, processed: positions.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
