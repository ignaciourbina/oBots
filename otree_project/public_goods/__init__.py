from otree.api import *

doc = """
Public Goods Game — 3-player multiplayer.
Each player receives an endowment and decides how much to contribute to a group fund.
The group fund is multiplied and split equally among all players.
"""


class C(BaseConstants):
    NAME_IN_URL = 'public_goods'
    PLAYERS_PER_GROUP = 3
    NUM_ROUNDS = 3
    ENDOWMENT = cu(100)
    MULTIPLIER = 2


class Subsession(BaseSubsession):
    pass


class Group(BaseGroup):
    total_contribution = models.CurrencyField()
    individual_share = models.CurrencyField()


class Player(BasePlayer):
    contribution = models.CurrencyField(
        min=0,
        max=C.ENDOWMENT,
        label="How much will you contribute to the group fund?",
    )


# ── PAGES ──────────────────────────────────────────────────


class Introduction(Page):
    """Shown once at the start of round 1."""

    @staticmethod
    def is_displayed(player: Player):
        return player.round_number == 1


class Contribute(Page):
    """Each player decides their contribution."""

    form_model = 'player'
    form_fields = ['contribution']


class ResultsWaitPage(WaitPage):
    """Wait for all group members, then compute payoffs."""

    @staticmethod
    def after_all_players_arrive(group: Group):
        contributions = [p.contribution for p in group.get_players()]
        group.total_contribution = sum(contributions)
        group.individual_share = (
            group.total_contribution * C.MULTIPLIER / C.PLAYERS_PER_GROUP
        )
        for p in group.get_players():
            p.payoff = C.ENDOWMENT - p.contribution + group.individual_share


class Results(Page):
    """Show the results of this round."""

    @staticmethod
    def vars_for_template(player: Player):
        group = player.group
        return dict(
            multiplied_total=group.total_contribution * C.MULTIPLIER,
        )


page_sequence = [Introduction, Contribute, ResultsWaitPage, Results]
