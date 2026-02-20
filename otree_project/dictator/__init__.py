from otree.api import *

doc = """
Dictator Game — 2-player multiplayer.
Player 1 (dictator) decides how to split an endowment with Player 2 (receiver).
Player 2 has no decision to make — they simply receive what is offered.
"""


class C(BaseConstants):
    NAME_IN_URL = 'dictator'
    PLAYERS_PER_GROUP = 2
    NUM_ROUNDS = 2
    ENDOWMENT = cu(100)


class Subsession(BaseSubsession):
    pass


class Group(BaseGroup):
    kept = models.CurrencyField(
        doc="Amount the dictator keeps for themselves",
        min=0,
        max=C.ENDOWMENT,
    )


class Player(BasePlayer):
    pass


# ── PAGES ──────────────────────────────────────────────────


class Introduction(Page):
    """Shown once at the start of round 1."""

    @staticmethod
    def is_displayed(player: Player):
        return player.round_number == 1


class Offer(Page):
    """Dictator (Player 1) decides how much to keep."""

    form_model = 'group'
    form_fields = ['kept']

    @staticmethod
    def is_displayed(player: Player):
        return player.id_in_group == 1


class ResultsWaitPage(WaitPage):
    """Wait for both players, then compute payoffs."""

    @staticmethod
    def after_all_players_arrive(group: Group):
        p1 = group.get_player_by_id(1)
        p2 = group.get_player_by_id(2)
        p1.payoff = group.kept
        p2.payoff = C.ENDOWMENT - group.kept


class Results(Page):
    """Show results to both players."""

    @staticmethod
    def vars_for_template(player: Player):
        return dict(
            offer=C.ENDOWMENT - player.group.kept,
        )


page_sequence = [Introduction, Offer, ResultsWaitPage, Results]
