from os import environ

SESSION_CONFIGS = [
    dict(
        name='public_goods',
        display_name='Public Goods Game',
        app_sequence=['public_goods'],
        num_demo_participants=3,
    ),
    dict(
        name='dictator',
        display_name='Dictator Game',
        app_sequence=['dictator'],
        num_demo_participants=2,
    ),
    dict(
        name='signal_conditional_pgg',
        display_name='Signal + Beliefs Conditional PGG (Stress Test)',
        app_sequence=['signal_conditional_pgg'],
        num_demo_participants=12,
    ),
    dict(
        name='matrix_signal_attention',
        display_name='Discrete Matrix Coordination + Signals + Attention Checks',
        app_sequence=['matrix_signal_attention'],
        num_demo_participants=12,
    ),
    dict(
        name='stress_multi_app_suite',
        display_name='Stress Suite: Multi-App + Reshuffling + Wait Barriers',
        app_sequence=[
            'matrix_signal_attention',
            'dictator',
            'signal_conditional_pgg',
            'reshuffle_threshold_pgg',
            'public_goods',
        ],
        num_demo_participants=12,
    ),
]

SESSION_CONFIG_DEFAULTS = dict(
    real_world_currency_per_point=1.00,
    participation_fee=0.00,
    doc="",
)

PARTICIPANT_FIELDS = []
SESSION_FIELDS = []

# Room configurations for lab/in-person sessions.
# You can launch sessions into a specific room from the oTree admin UI.
ROOMS = [
    dict(
        name='live_lab',
        display_name='Live Lab Room',
    ),
    dict(
        name='bot_stress_lab',
        display_name='Bot Stress Test Room',
    ),
]

LANGUAGE_CODE = 'en'
REAL_WORLD_CURRENCY_CODE = 'USD'
USE_POINTS = True

ADMIN_USERNAME = 'admin'
ADMIN_PASSWORD = environ.get('OTREE_ADMIN_PASSWORD', 'admin')

DEMO_PAGE_INTRO_HTML = """
<h3>oTree Bot Testing Server</h3>
<p>This oTree project contains simple multiplayer games for testing the otree-bots framework.</p>
"""

SECRET_KEY = 'otree-bots-dev-testing-key-not-for-production'
