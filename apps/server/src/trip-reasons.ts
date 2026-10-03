import type { TripType } from '@pax/shared';

// Local catalog source. Future database/AI providers should return the same editable reason text.
// These are fictional purposes, not claims about live weather, events, airports or cargo bookings.
export const tripReasons: Record<TripType, readonly string[]> = {
  sightseeing: [
    'Celebrating a first solo holiday with a scenic flight. Usually plans every detail, but wants one afternoon spent simply looking out of the window.',
    'Taking reference photographs for a personal landscape project. Patient about finding a good view and more interested in shapes and light than dramatic flying.',
    'Marking an anniversary with a flight over unfamiliar scenery. Quietly sentimental and hoping to bring home a story worth sharing over dinner.',
    'Trying a small-aircraft flight before committing to flying lessons. Curious about the experience, with a notebook full of questions saved for quieter moments.',
    'Returning to a region remembered from childhood and hoping to see it from a new angle. Nostalgic, but knows familiar places may have changed.',
    'Taking a short break after finishing a demanding project. Normally talkative, but would welcome a peaceful flight with room to enjoy the scenery.',
    'Using a birthday gift voucher for a first scenic flight. A little nervous about takeoff, yet determined to enjoy an experience normally avoided.',
    'Collecting impressions for a travel journal written for family. Notices small details and wants an honest account, not a list of famous landmarks.',
    'Sharing an interest in maps with a young relative through photos after the trip. Enjoys spotting patterns in the landscape without pretending to know every place.',
    'Taking a flight as a personal milestone after a long period of saving. Delighted to be here and keen to make the experience last without asking for special maneuvers.',
  ],
  'light-cargo': [
    'Accompanying a carefully packed prototype to a product demonstration. Checks the delivery paperwork twice and worries more about a scratched case than personal comfort.',
    'Escorting replacement parts for a workshop waiting to resume repairs. Practical and punctual, with a contact expecting a call after arrival.',
    'Delivering fabric samples to a small clothing studio before its collection review. Proud of the materials and eager to explain why the textures matter.',
    'Accompanying archived family photographs to a specialist digitization appointment. The boxes are modest, but their contents feel irreplaceable.',
    'Escorting a compact audio kit to a community recording project. Carefully organized, with spare cables packed and a habit of mentally checking the inventory.',
    'Delivering handmade display pieces to a craft exhibition. Excited about a first public showing and protective of the padded boxes.',
    'Accompanying a repaired musical instrument back to its owner. Values the trust involved and wants a calm handover rather than a rushed delivery.',
    'Transporting printed proofs for an independent publisher’s final review. Detail-minded and carrying a handwritten list of the pages that need discussion.',
    'Escorting a small batch of nonperishable specialty ingredients to a tasting appointment. Enthusiastic about the producer’s story and hoping the buyer shares that interest.',
    'Delivering measurement equipment to a field team for a planned survey. Methodical about the cases and looking forward to hearing what the team discovers.',
  ],
  'vip-executive': [
    'Traveling to a partnership meeting after months of remote calls. Well prepared but aware that listening in person may matter more than the presentation.',
    'Visiting a newly opened branch to meet its small team. Dislikes ceremonial welcomes and would rather hear what is actually making their work difficult.',
    'Attending the final discussion on a family-business succession plan. Outwardly composed, with personal feelings tied to every practical decision.',
    'Heading to a private investor briefing for a growing venture. Rehearses the opening quietly and is determined to describe the risks as honestly as the opportunities.',
    'Traveling to resolve a strained supplier relationship face to face. Diplomatic and thoughtful, hoping to leave with a workable agreement rather than a victory.',
    'Visiting a potential site for a new operation. Curious about the people and surroundings, and unwilling to decide solely from a polished brochure.',
    'Attending a confidential leadership retreat after a difficult quarter. Wants space to think and appreciates a passenger conversation that does not feel like another meeting.',
    'Traveling to approve the final design of a flagship workspace. Precise about details, but particularly concerned that the space will work for ordinary staff.',
    'Meeting a prospective cofounder to discuss a long-considered business idea. Optimistic, slightly guarded, and aware that shared values matter more than a clever pitch.',
    'Returning from a series of negotiations with decisions still to make. Tired of formal small talk and grateful for a quiet, discreet journey.',
  ],
  'vip-special-event': [
    'Traveling as a guest speaker at a small charity fundraiser. Comfortable on stage but anxious to tell the beneficiaries’ stories respectfully.',
    'Attending a close friend’s wedding as a witness. Carrying a carefully revised toast and determined not to let nerves overshadow the celebration.',
    'Heading to an award ceremony where a long-running community project is being recognized. Proud of the team and uncomfortable taking the spotlight alone.',
    'Arriving as an invited guest at a private film screening. Interested in the creative process and hoping for a genuine conversation with the people who made it.',
    'Traveling to a family milestone celebration after missing several earlier gatherings. Excited to reconnect and quietly worried about feeling like an outsider.',
    'Attending the opening of an exhibition featuring a close collaborator. Knows how much work went unseen and wants to be there before the first guests arrive.',
    'Heading to a university reunion as an invited mentor. Curious about younger graduates and more interested in their questions than retelling old successes.',
    'Traveling as a special guest at a youth sports presentation. Takes the responsibility seriously and has prepared a short message about persistence rather than winning.',
    'Attending a private memorial gathering for someone who offered early encouragement. Reflective and grateful for a journey that allows a little quiet beforehand.',
    'Heading to a book launch hosted by a longtime friend. Has followed the manuscript through years of revisions and wants to celebrate the person behind the finished work.',
  ],
};
